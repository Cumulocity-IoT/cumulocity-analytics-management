"""Tests for C8YAgent using a fake async tenant (no network, no pyc8y calls)."""

import json
from unittest.mock import AsyncMock, MagicMock

import pytest

import c8y_agent
from c8y_agent import C8YAgent, C8YAgentError

DUMMY = C8YAgent.DUMMY_ACCESS_TOKEN


class AsyncIter:
    def __init__(self, items):
        self._items = list(items)

    def __aiter__(self):
        self._it = iter(self._items)
        return self

    async def __anext__(self):
        try:
            return next(self._it)
        except StopIteration:
            raise StopAsyncIteration


def mo(id_, **fragments):
    obj = MagicMock()
    obj.id = id_
    obj.get = lambda k, d=None: fragments.get(k, d)
    return obj


@pytest.fixture
def tenant():
    t = MagicMock(name="tenant")
    t.tenant_options.get_value = AsyncMock()
    t.tenant_options.get_values = AsyncMock()
    t.tenant_options.delete = AsyncMock()
    t.binaries.delete = AsyncMock()
    t.inventory.get = AsyncMock()
    t.get = AsyncMock()
    t.put = AsyncMock()
    return t


@pytest.fixture
def agent(tenant, run_agent_work):
    return run_agent_work(C8YAgent(), tenant)


REQ = object()


class TestParseRepositoryValue:
    def setup_method(self):
        self.agent = C8YAgent()

    def test_masks_token_by_default(self):
        value = json.dumps({"name": "n", "url": "u", "accessToken": "secret", "enabled": True})
        result = self.agent._parse_repository_value(value, "id1")
        assert result == {"id": "id1", "name": "n", "url": "u", "accessToken": DUMMY, "enabled": True}

    def test_returns_real_token_when_requested(self):
        value = json.dumps({"accessToken": "secret"})
        assert self.agent._parse_repository_value(value, "i", replace_access_token=False)["accessToken"] == "secret"

    def test_no_token_stays_empty(self):
        assert self.agent._parse_repository_value("{}", "i")["accessToken"] == ""

    def test_non_json_value_falls_back_to_defaults(self):
        result = self.agent._parse_repository_value("legacy-value", "i")
        assert result["name"] == "legacy-value"
        assert result["enabled"] is False

    def test_none_value(self):
        assert self.agent._parse_repository_value(None, "i")["id"] == "i"


class TestSaveRepository:
    @staticmethod
    def _saved(monkeypatch):
        created = []

        class FakeOption:
            def __init__(self, **kw):
                self.kw = kw

            async def create(self):
                created.append(self.kw)

        monkeypatch.setattr(c8y_agent, "TenantOption", FakeOption)
        return created

    async def _save(self, agent, tenant, repo, existing=None):
        if existing is None:
            tenant.tenant_options.get_value.side_effect = KeyError
        else:
            tenant.tenant_options.get_value.return_value = json.dumps(existing)
        await agent._save_repository(tenant, repo)

    @pytest.mark.asyncio
    async def test_dummy_sentinel_keeps_stored_token(self, tenant, monkeypatch):
        created = self._saved(monkeypatch)
        await self._save(
            C8YAgent(), tenant,
            {"id": "r", "name": "n", "url": "u", "accessToken": DUMMY},
            existing={"url": "u", "accessToken": "stored"},
        )
        assert json.loads(created[0]["value"])["accessToken"] == "stored"

    @pytest.mark.asyncio
    async def test_absent_token_keeps_stored_token(self, tenant, monkeypatch):
        created = self._saved(monkeypatch)
        await self._save(
            C8YAgent(), tenant, {"id": "r", "name": "n", "url": "u"},
            existing={"url": "u", "accessToken": "stored"},
        )
        assert json.loads(created[0]["value"])["accessToken"] == "stored"

    @pytest.mark.asyncio
    async def test_new_token_replaces_stored(self, tenant, monkeypatch):
        created = self._saved(monkeypatch)
        await self._save(
            C8YAgent(), tenant, {"id": "r", "name": "n", "url": "u", "accessToken": "new"},
            existing={"url": "u", "accessToken": "stored"},
        )
        assert json.loads(created[0]["value"])["accessToken"] == "new"

    @pytest.mark.asyncio
    async def test_empty_token_clears(self, tenant, monkeypatch):
        created = self._saved(monkeypatch)
        await self._save(
            C8YAgent(), tenant, {"id": "r", "name": "n", "url": "u", "accessToken": ""},
            existing={"url": "u", "accessToken": "stored"},
        )
        assert "accessToken" not in json.loads(created[0]["value"])

    @pytest.mark.asyncio
    async def test_url_change_clears_token(self, tenant, monkeypatch):
        created = self._saved(monkeypatch)
        await self._save(
            C8YAgent(), tenant, {"id": "r", "name": "n", "url": "https://other", "accessToken": DUMMY},
            existing={"url": "u", "accessToken": "stored"},
        )
        assert "accessToken" not in json.loads(created[0]["value"])

    @pytest.mark.asyncio
    async def test_url_change_with_new_token_keeps_new_token(self, tenant, monkeypatch):
        created = self._saved(monkeypatch)
        await self._save(
            C8YAgent(), tenant, {"id": "r", "name": "n", "url": "https://other", "accessToken": "fresh"},
            existing={"url": "u", "accessToken": "stored"},
        )
        assert json.loads(created[0]["value"])["accessToken"] == "fresh"

    @pytest.mark.asyncio
    async def test_new_repository(self, tenant, monkeypatch):
        created = self._saved(monkeypatch)
        await self._save(C8YAgent(), tenant, {"id": "r", "name": "n", "url": "u", "enabled": 1})
        assert created[0]["category"] == C8YAgent.CATEGORY
        assert created[0]["key"] == "r"
        assert json.loads(created[0]["value"]) == {"name": "n", "url": "u", "enabled": True}

    @pytest.mark.asyncio
    async def test_missing_id_raises(self, tenant):
        with pytest.raises(ValueError):
            await C8YAgent()._save_repository(tenant, {"name": "n"})


class TestRepositories:
    def test_load_repositories(self, agent, tenant):
        tenant.tenant_options.get_values.return_value = {
            "a": json.dumps({"name": "A", "accessToken": "t"}),
            "b": json.dumps({"name": "B"}),
        }
        result = agent.load_repositories(REQ)
        assert [r["id"] for r in result] == ["a", "b"]
        assert result[0]["accessToken"] == DUMMY

    def test_load_repositories_none_configured(self, agent, tenant):
        tenant.tenant_options.get_values.side_effect = KeyError
        assert agent.load_repositories(REQ) == []

    def test_load_repository_missing_returns_none(self, agent, tenant):
        tenant.tenant_options.get_value.side_effect = KeyError
        assert agent.load_repository(REQ, "x") is None

    def test_load_repository_unmasked(self, agent, tenant):
        tenant.tenant_options.get_value.return_value = json.dumps({"accessToken": "t"})
        assert agent.load_repository(REQ, "x", replace_access_token=False)["accessToken"] == "t"

    def test_update_deletes_repositories_not_in_request(self, agent, tenant, monkeypatch):
        tenant.tenant_options.get_values.return_value = {"old": "{}", "keep": "{}"}
        saved = []

        async def fake_save(self_, t, repo):
            saved.append(repo["id"])

        monkeypatch.setattr(C8YAgent, "_save_repository", fake_save)
        body, status = agent.update_repositories(REQ, [{"id": "keep", "name": "n", "url": "u"}, {"id": "new", "name": "n", "url": "u"}])

        assert status == 200
        assert saved == ["keep", "new"]
        tenant.tenant_options.delete.assert_awaited_once_with(category=C8YAgent.CATEGORY, key="old")

    def test_update_failure_returns_500(self, agent, tenant):
        tenant.tenant_options.get_values.side_effect = RuntimeError("down")
        body, status = agent.update_repositories(REQ, [])
        assert status == 500
        assert "down" in body["error"]


class TestDeleteExtension:
    def test_requires_id_or_name(self, agent):
        with pytest.raises(ValueError):
            agent.delete_extension(REQ)

    @pytest.mark.parametrize("name", ["it's", "a\\b", "x' or 1 eq 1 or name eq 'y"])
    def test_rejects_query_injection_in_name(self, agent, tenant, name):
        with pytest.raises(ValueError):
            agent.delete_extension(REQ, extension_name=name)
        tenant.inventory.select.assert_not_called()

    def test_by_id(self, agent, tenant):
        tenant.inventory.get.return_value = {"pas_extension": "E", "name": "E"}
        assert agent.delete_extension(REQ, extension_id="5") == 1
        tenant.binaries.delete.assert_awaited_once_with("5")

    def test_by_id_not_found(self, agent, tenant):
        tenant.inventory.get.side_effect = KeyError
        with pytest.raises(C8YAgentError, match="not found"):
            agent.delete_extension(REQ, extension_id="5")

    def test_by_id_rejects_non_extension_objects(self, agent, tenant):
        tenant.inventory.get.return_value = {"name": "some device"}
        with pytest.raises(C8YAgentError, match="not a valid extension"):
            agent.delete_extension(REQ, extension_id="5")
        tenant.binaries.delete.assert_not_called()

    def test_by_name_none_found_returns_zero(self, agent, tenant):
        tenant.inventory.select = MagicMock(return_value=AsyncIter([]))
        assert agent.delete_extension(REQ, extension_name="E") == 0

    def test_by_name_query_targets_extensions_only(self, agent, tenant):
        tenant.inventory.select = MagicMock(return_value=AsyncIter([]))
        agent.delete_extension(REQ, extension_name="E")
        assert tenant.inventory.select.call_args.kwargs["query"] == "name eq 'E' and has(pas_extension)"

    def test_by_name_counts_only_successful_deletes(self, agent, tenant):
        tenant.inventory.select = MagicMock(return_value=AsyncIter([mo("1"), mo("2"), mo("3")]))
        tenant.binaries.delete.side_effect = [None, RuntimeError("x"), None]
        assert agent.delete_extension(REQ, extension_name="E") == 2

    def test_unexpected_failure_is_wrapped(self, tenant, monkeypatch):
        agent = C8YAgent()
        monkeypatch.setattr(agent, "_execute", MagicMock(side_effect=RuntimeError("net")))
        with pytest.raises(C8YAgentError, match="Failed to delete"):
            agent.delete_extension(REQ, extension_name="E")


class TestUploadExtension:
    def test_wraps_errors(self, monkeypatch):
        agent = C8YAgent()
        monkeypatch.setattr(agent, "_execute", MagicMock(side_effect=RuntimeError("net")))
        with pytest.raises(C8YAgentError, match="Failed to upload"):
            agent.upload_extension(REQ, "E", b"zip")

    def test_returns_binary_id(self, agent, monkeypatch):
        class FakeBinary:
            def __init__(self, **kw):
                self.kw = kw
                FakeBinary.last = kw

            async def create(self):
                self.id = "bin-1"
                return self

        monkeypatch.setattr(c8y_agent, "Binary", FakeBinary)
        assert agent.upload_extension(REQ, "E", b"zip", {"a": 1}) == "bin-1"
        assert FakeBinary.last["pas_extension"] == "E"
        assert FakeBinary.last["build_information"] == {"a": 1}


class TestCep:
    def test_restart_is_best_effort(self, tenant, monkeypatch):
        agent = C8YAgent()
        monkeypatch.setattr(agent, "_execute", MagicMock(side_effect=RuntimeError("x")))
        agent.restart_cep(REQ)  # must not raise

    def test_restart_puts_to_cep(self, agent, tenant):
        agent.restart_cep(REQ)
        tenant.put.assert_awaited_once_with(C8YAgent.PATHS["CEP_RESTART"], json={})

    def test_status_returns_none_on_error(self, tenant, monkeypatch):
        agent = C8YAgent()
        monkeypatch.setattr(agent, "_execute", MagicMock(side_effect=RuntimeError("x")))
        assert agent.get_cep_ctrl_status(REQ) is None

    def test_status(self, agent, tenant):
        tenant.get.return_value = {"status": "Up"}
        assert agent.get_cep_ctrl_status(REQ) == {"status": "Up"}

    def test_operation_object_id(self, agent, tenant):
        tenant.get.return_value = {"microservice_application_id": "7", "microservice_name": "apama"}
        tenant.inventory.select = MagicMock(return_value=AsyncIter([mo("99")]))
        assert agent.get_cep_operationobject_id(REQ) == {"id": "99"}

    def test_operation_object_id_missing_diagnostics(self, agent, tenant):
        tenant.get.return_value = {}
        assert agent.get_cep_operationobject_id(REQ) is None

    def test_operation_object_id_no_inventory_match(self, agent, tenant):
        tenant.get.return_value = {"microservice_application_id": "7", "microservice_name": "apama"}
        tenant.inventory.select = MagicMock(return_value=AsyncIter([]))
        assert agent.get_cep_operationobject_id(REQ) is None


class TestExecute:
    def test_auth_failure_is_wrapped(self, monkeypatch):
        class FakeApp:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *a):
                return False

            async def get_tenant_instance(self, **kw):
                raise RuntimeError("401")

        monkeypatch.setattr(c8y_agent, "MultiTenantCumulocityApp", FakeApp)
        request = MagicMock(headers={}, cookies={})

        async def work(t):
            return "never"

        with pytest.raises(C8YAgentError, match="authenticate"):
            C8YAgent()._execute(request, work)
