"""Role checks: who may call which route (READ < CREATE < ADMIN)."""

from unittest.mock import MagicMock

import pytest

import app as app_module
from c8y_agent import C8YAgentError, C8YAuthenticationError

READ = app_module.ROLE_READ
CREATE = app_module.ROLE_CREATE
ADMIN = app_module.ROLE_ADMIN

REPO_URL = "https://github.com/o/r/tree/main/blocks"
REPO = {"id": "repo-1", "name": "Repo", "url": REPO_URL, "accessToken": "", "enabled": True}
BUILD_BODY = {"extension_name": "E", "repository": {"id": "repo-1"}}
LIST_BODY = {**BUILD_BODY, "monitors": [{"url": "https://github.com/o/r", "type": "file"}]}
YAML_BODY = {
    "yaml": {"url": "https://raw.githubusercontent.com/o/r/main/e.yaml"},
    "repository": {"id": "repo-1"},
}

# (method, path, json body, minimum role)
ROUTES = [
    ("GET", "/cep/id", None, READ),
    ("GET", "/cep/status", None, READ),
    ("GET", "/repository/configuration", None, READ),
    ("GET", "/repository/contentList?url=https://github.com/o/r", None, READ),
    ("GET", "/repository/content?url=https://raw.githubusercontent.com/o/r/main/A.mon", None, READ),
    ("POST", "/repository/configuration", [], ADMIN),
    ("POST", "/extension/repository", BUILD_BODY, READ),
    ("POST", "/extension/list", LIST_BODY, READ),
    ("POST", "/extension/yaml", YAML_BODY, READ),
    ("DELETE", "/extension/123", None, ADMIN),
    ("DELETE", "/extension?name=E", None, ADMIN),
]

_RANK = {READ: 0, CREATE: 1, ADMIN: 2}


def _call(client, method, path, body):
    return client.open(path, method=method, json=body) if body is not None else client.open(path, method=method)


def _denied(resp):
    return resp.status_code == 403 and "Missing required role" in resp.get_json()["error"]


class TestEveryRouteIsProtected:
    def test_all_routes_declare_a_role_or_are_public(self):
        missing = []
        for rule in app_module.app.url_map.iter_rules():
            view = app_module.app.view_functions[rule.endpoint]
            if not (getattr(view, "is_public", False) or getattr(view, "required_role", None)):
                missing.append(f"{sorted(rule.methods)} {rule.rule}")
        assert not missing

    def test_only_health_is_public(self):
        public = [
            rule.rule
            for rule in app_module.app.url_map.iter_rules()
            if getattr(app_module.app.view_functions[rule.endpoint], "is_public", False)
        ]
        assert public == ["/health"]

    def test_route_table_in_this_file_is_complete(self):
        covered = {path.split("?")[0] for _, path, _, _ in ROUTES}
        declared = {
            rule.rule.replace("<extension_id>", "123")
            for rule in app_module.app.url_map.iter_rules()
            if getattr(app_module.app.view_functions[rule.endpoint], "required_role", None)
        }
        assert declared == covered

    def test_route_without_role_is_denied(self, client, agent_mock, monkeypatch):
        monkeypatch.setitem(app_module.app.view_functions, "health", lambda: "ok")
        resp = client.get("/health")
        assert resp.status_code == 403
        agent_mock.get_caller_roles.assert_not_called()

    def test_declared_roles_match_this_table(self):
        by_path = {}
        for rule in app_module.app.url_map.iter_rules():
            view = app_module.app.view_functions[rule.endpoint]
            role = getattr(view, "required_role", None)
            if role:
                for method in rule.methods - {"HEAD", "OPTIONS"}:
                    by_path[(method, rule.rule.replace("<extension_id>", "123"))] = role
        expected = {(m, p.split("?")[0]): r for m, p, _, r in ROUTES}
        assert by_path == expected


class TestRoleMatrix:
    @pytest.mark.parametrize("method,path,body,required", ROUTES)
    def test_no_role_is_always_denied(self, client, agent_mock, method, path, body, required):
        agent_mock.get_caller_roles.return_value = set()
        assert _denied(_call(client, method, path, body))

    @pytest.mark.parametrize("method,path,body,required", ROUTES)
    def test_unrelated_roles_do_not_help(self, client, agent_mock, method, path, body, required):
        agent_mock.get_caller_roles.return_value = {
            "ROLE_OPTION_MANAGEMENT_ADMIN", "ROLE_INVENTORY_ADMIN", "ROLE_CEP_MANAGEMENT_ADMIN",
        }
        assert _denied(_call(client, method, path, body))

    @pytest.mark.parametrize("held", [READ, CREATE, ADMIN])
    @pytest.mark.parametrize("method,path,body,required", ROUTES)
    def test_route_allows_exactly_the_role_and_higher(
        self, client, agent_mock, method, path, body, required, held
    ):
        agent_mock.get_caller_roles.return_value = {held}
        agent_mock.load_repository.return_value = None  # routes stop early; only the check matters
        agent_mock.delete_extension.return_value = 1
        agent_mock.update_repositories.return_value = ({"message": "ok"}, 200)
        resp = _call(client, method, path, body)
        if _RANK[held] >= _RANK[required]:
            assert not _denied(resp) and resp.status_code != 401
        else:
            assert _denied(resp)

    def test_health_needs_no_credentials(self, client, agent_mock):
        assert client.get("/health").status_code == 200
        agent_mock.get_caller_roles.assert_not_called()

    def test_unknown_url_is_404_not_403(self, client):
        assert client.get("/nope").status_code == 404


class TestAuthenticationFailures:
    def test_rejected_credentials_are_401(self, client, agent_mock):
        agent_mock.get_caller_roles.side_effect = C8YAuthenticationError("no")
        resp = client.get("/cep/status")
        assert resp.status_code == 401
        agent_mock.get_cep_ctrl_status.assert_not_called()

    def test_platform_failure_is_503_and_denies(self, client, agent_mock):
        agent_mock.get_caller_roles.side_effect = C8YAgentError("Failed to read the roles of the caller")
        resp = client.delete("/extension/123")
        assert resp.status_code == 503
        agent_mock.delete_extension.assert_not_called()


class TestBuildRequestRoles:
    """upload needs CREATE; rebuild and deploy need ADMIN. Nothing may happen before the check."""

    @pytest.fixture(autouse=True)
    def _env(self, agent_mock, monkeypatch):
        agent_mock.load_repository.return_value = REPO
        agent_mock.delete_extension.return_value = 1
        agent_mock.upload_extension.return_value = "1"
        monkeypatch.setattr(
            app_module, "_build_and_process_extension", MagicMock(return_value=("built", 201))
        )
        monkeypatch.setattr(
            app_module, "_process_yaml_sections", MagicMock(return_value=("built", 201))
        )

    BODIES = {
        "/extension/repository": BUILD_BODY,
        "/extension/list": LIST_BODY,
        "/extension/yaml": YAML_BODY,
    }

    @pytest.mark.parametrize("path", BODIES)
    def test_download_needs_only_read(self, client, agent_mock, path):
        agent_mock.get_caller_roles.return_value = {READ}
        resp = client.post(path, json=self.BODIES[path])
        assert not _denied(resp)

    @pytest.mark.parametrize("path", BODIES)
    def test_upload_needs_create(self, client, agent_mock, path):
        body = {**self.BODIES[path], "upload": True}
        agent_mock.get_caller_roles.return_value = {READ}
        assert _denied(client.post(path, json=body))
        agent_mock.load_repository.assert_not_called()

        agent_mock.get_caller_roles.return_value = {CREATE}
        assert not _denied(client.post(path, json=body))

    @pytest.mark.parametrize("flag", ["rebuild", "deploy"])
    @pytest.mark.parametrize("path", BODIES)
    def test_rebuild_and_deploy_need_admin(self, client, agent_mock, path, flag):
        body = {**self.BODIES[path], "upload": True, flag: True}
        for held in ({READ}, {CREATE}):
            agent_mock.get_caller_roles.return_value = held
            assert _denied(client.post(path, json=body))
        agent_mock.load_repository.assert_not_called()
        agent_mock.delete_extension.assert_not_called()

        agent_mock.get_caller_roles.return_value = {ADMIN}
        assert not _denied(client.post(path, json=body))

    @pytest.mark.parametrize("flag", ["rebuild", "deploy"])
    def test_flags_without_upload_still_need_admin(self, client, agent_mock, flag):
        agent_mock.get_caller_roles.return_value = {CREATE}
        resp = client.post("/extension/repository", json={**BUILD_BODY, flag: True})
        assert _denied(resp)

    def test_string_flag_counts_like_the_route_treats_it(self, client, agent_mock):
        """The route treats any non-empty value as true, so the check must too."""
        agent_mock.get_caller_roles.return_value = {READ}
        resp = client.post("/extension/repository", json={**BUILD_BODY, "upload": "false"})
        assert _denied(resp)


class TestRoleHierarchy:
    @pytest.mark.parametrize(
        "held,required,allowed",
        [
            ({READ}, READ, True), ({READ}, CREATE, False), ({READ}, ADMIN, False),
            ({CREATE}, READ, True), ({CREATE}, CREATE, True), ({CREATE}, ADMIN, False),
            ({ADMIN}, READ, True), ({ADMIN}, CREATE, True), ({ADMIN}, ADMIN, True),
            (set(), READ, False), ({"ROLE_OTHER"}, READ, False), ({READ, CREATE}, ADMIN, False),
        ],
    )
    def test_has_role(self, held, required, allowed):
        assert app_module._has_role(held, required) is allowed

    def test_requires_role_rejects_unknown_roles(self):
        with pytest.raises(ValueError):
            app_module.requires_role("ROLE_MADE_UP")
