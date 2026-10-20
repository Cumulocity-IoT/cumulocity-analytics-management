"""Endpoint and helper tests for app.py (Cumulocity agent and GitHub are mocked)."""

import io
import json
import subprocess
from unittest.mock import MagicMock

import pytest

import app as app_module
from c8y_agent import C8YAgentError

REPO = {
    "id": "repo-1",
    "name": "Repo",
    "url": "https://github.com/o/r/tree/main/blocks",
    "accessToken": "ghp_secret",
    "enabled": True,
}


# ---------------------------------------------------------------- health / cep


def test_health(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.get_json() == {"status": "UP"}


def test_cep_id_found(client, agent_mock):
    agent_mock.get_cep_operationobject_id.return_value = {"id": "42"}
    resp = client.get("/cep/id")
    assert resp.status_code == 200
    assert resp.get_json() == {"id": "42"}


def test_cep_id_not_found(client, agent_mock):
    agent_mock.get_cep_operationobject_id.return_value = None
    assert client.get("/cep/id").status_code == 404


def test_cep_status(client, agent_mock):
    agent_mock.get_cep_ctrl_status.return_value = {"status": "Up"}
    assert client.get("/cep/status").get_json() == {"status": "Up"}
    agent_mock.get_cep_ctrl_status.return_value = None
    assert client.get("/cep/status").status_code == 404


# ------------------------------------------------------ repository configuration


def test_load_repositories(client, agent_mock):
    agent_mock.load_repositories.return_value = [REPO]
    resp = client.get("/repository/configuration")
    assert resp.status_code == 200
    assert resp.get_json() == [REPO]


class TestUpdateRepositories:
    def test_success_delegates_to_agent(self, client, agent_mock):
        agent_mock.update_repositories.return_value = ({"message": "ok"}, 200)
        resp = client.post("/repository/configuration", json=[REPO])
        assert resp.status_code == 200
        agent_mock.update_repositories.assert_called_once()

    def test_empty_list_is_allowed(self, client, agent_mock):
        agent_mock.update_repositories.return_value = ({"message": "ok"}, 200)
        assert client.post("/repository/configuration", json=[]).status_code == 200

    @pytest.mark.parametrize("body", [{"id": "x"}, "text", 5])
    def test_non_array_rejected(self, client, body):
        assert client.post("/repository/configuration", json=body).status_code == 400

    def test_non_json_body_rejected_with_400(self, client):
        resp = client.post(
            "/repository/configuration", data="nope", content_type="text/plain"
        )
        assert resp.status_code == 400

    def test_missing_required_field(self, client):
        resp = client.post("/repository/configuration", json=[{"id": "a", "name": "n"}])
        assert resp.status_code == 400
        assert "id, name, and url" in resp.get_json()["error"]

    def test_non_object_item_rejected_with_400(self, client):
        assert client.post("/repository/configuration", json=["a"]).status_code == 400


# ------------------------------------------------------------ repository content


class TestContentList:
    def test_requires_url(self, client):
        assert client.get("/repository/contentList").status_code == 400

    def test_converts_url_and_uses_stored_pat(self, client, agent_mock, monkeypatch, fake_response):
        agent_mock.load_repository.return_value = REPO
        get = MagicMock(return_value=fake_response(200, json_data=[], content=b"[]"))
        monkeypatch.setattr(app_module.requests, "get", get)

        resp = client.get(
            "/repository/contentList",
            query_string={"url": "https://github.com/o/r/tree/main/blocks", "repository_id": "repo-1"},
        )

        assert resp.status_code == 200
        assert resp.mimetype == "application/json"
        called_url = get.call_args.args[0]
        assert called_url == "https://api.github.com/repos/o/r/contents/blocks?ref=main"
        assert get.call_args.kwargs["headers"]["Authorization"] == "Bearer ghp_secret"

    def test_header_pat_takes_precedence(self, client, agent_mock, monkeypatch, fake_response):
        get = MagicMock(return_value=fake_response(200, json_data=[], content=b"[]"))
        monkeypatch.setattr(app_module.requests, "get", get)
        client.get(
            "/repository/contentList",
            query_string={"url": "https://github.com/o/r", "repository_id": "repo-1"},
            headers={"X-Repository-Access-Token": "draft"},
        )
        assert get.call_args.kwargs["headers"]["Authorization"] == "Bearer draft"
        agent_mock.load_repository.assert_not_called()

    def test_github_error_is_propagated(self, client, agent_mock, monkeypatch, fake_response):
        agent_mock.load_repository.return_value = None
        monkeypatch.setattr(
            app_module.requests, "get",
            MagicMock(return_value=fake_response(404, json_data={"message": "Not Found"})),
        )
        resp = client.get("/repository/contentList", query_string={"url": "https://github.com/o/r"})
        assert resp.status_code == 404
        assert resp.get_json() == {"error": "Not Found"}

    def test_invalid_github_url_is_400(self, client):
        resp = client.get("/repository/contentList", query_string={"url": "https://example.com/x/y"})
        assert resp.status_code == 400


class TestContent:
    RAW = "https://raw.githubusercontent.com/o/r/main/blocks/Foo.mon"

    def test_requires_url(self, client):
        assert client.get("/repository/content").status_code == 400

    def test_returns_raw_content(self, client, monkeypatch, fake_response):
        monkeypatch.setattr(
            app_module.requests, "get",
            MagicMock(return_value=fake_response(200, text="package a.b;", content=b"package a.b;")),
        )
        resp = client.get("/repository/content", query_string={"url": self.RAW})
        assert resp.status_code == 200
        assert resp.get_data(as_text=True) == "package a.b;"

    def test_extracts_fqn(self, client, monkeypatch, fake_response):
        monkeypatch.setattr(
            app_module.requests, "get",
            MagicMock(return_value=fake_response(200, text="package com.x.blocks;\nevent Foo {}")),
        )
        resp = client.get(
            "/repository/content",
            query_string={"url": self.RAW, "extract_fqn_cep_block": "true", "cep_block_name": "Foo"},
        )
        assert resp.get_data(as_text=True) == "com.x.blocks.Foo"

    def test_fqn_requires_block_name(self, client, monkeypatch, fake_response):
        monkeypatch.setattr(
            app_module.requests, "get", MagicMock(return_value=fake_response(200, text="package a;"))
        )
        resp = client.get(
            "/repository/content", query_string={"url": self.RAW, "extract_fqn_cep_block": "true"}
        )
        assert resp.status_code == 400

    def test_fqn_without_package_is_400(self, client, monkeypatch, fake_response):
        monkeypatch.setattr(
            app_module.requests, "get", MagicMock(return_value=fake_response(200, text="event Foo {}"))
        )
        resp = client.get(
            "/repository/content",
            query_string={"url": self.RAW, "extract_fqn_cep_block": "true", "cep_block_name": "Foo"},
        )
        assert resp.status_code == 400

    @pytest.mark.parametrize(
        "url",
        [
            "http://raw.githubusercontent.com/o/r/main/a.mon",   # not https
            "https://evil.example.com/a.mon",                    # foreign host
            "https://github.com.evil.example.com/a.mon",         # look-alike host
            "http://169.254.169.254/latest/meta-data",           # SSRF target
        ],
    )
    def test_never_sends_pat_to_non_github_hosts(self, client, monkeypatch, url):
        get = MagicMock()
        monkeypatch.setattr(app_module.requests, "get", get)
        resp = client.get(
            "/repository/content",
            query_string={"url": url},
            headers={"X-Repository-Access-Token": "secret"},
        )
        assert resp.status_code == 400
        get.assert_not_called()


# --------------------------------------------------------------- github errors


class TestGithubErrorResponse:
    def test_ok_returns_none(self, fake_response):
        assert app_module._github_error_response(fake_response(200)) is None

    def test_rate_limit_message(self, fake_response):
        resp = fake_response(
            403, headers={"X-RateLimit-Remaining": "0", "X-RateLimit-Reset": "1700000000"}
        )
        out = app_module._github_error_response(resp)
        assert out.status_code == 403
        assert "rate limit" in out.get_data(as_text=True)
        assert "2023-11-14 22:13 UTC" in out.get_data(as_text=True)

    def test_sso_message(self, fake_response):
        out = app_module._github_error_response(
            fake_response(403, headers={"X-GitHub-SSO": "required; url=x"})
        )
        assert "single sign-on" in out.get_data(as_text=True)

    def test_falls_back_to_github_message(self, fake_response):
        out = app_module._github_error_response(fake_response(401, json_data={"message": "Bad credentials"}))
        assert out.status_code == 401
        assert json.loads(out.get_data(as_text=True)) == {"error": "Bad credentials"}

    def test_falls_back_to_generic_message(self, fake_response):
        out = app_module._github_error_response(fake_response(500))
        assert out.status_code == 500
        assert "GitHub request failed (500)" in out.get_data(as_text=True)


# ----------------------------------------------------------------------- helpers


class TestHelpers:
    @pytest.mark.parametrize("name", ["abc", "A_b-9", "x" * 100])
    def test_valid_extension_names(self, name):
        assert app_module._validate_extension_name(name) is None

    @pytest.mark.parametrize("name", ["", None, "a b", "a/b", "../x", "a.zip", "a'b"])
    def test_invalid_extension_names(self, name):
        assert app_module._validate_extension_name(name)

    def test_extract_fqn(self):
        assert app_module._extract_fqn("package a.b.c ;\n", "X") == "a.b.c.X"
        with pytest.raises(ValueError):
            app_module._extract_fqn("nothing", "X")

    def test_safe_join_inside(self, tmp_path):
        out = app_module._safe_join(str(tmp_path), "a/b.mon")
        assert out == str((tmp_path / "a" / "b.mon").resolve())

    @pytest.mark.parametrize("rel", ["../x", "a/../../x", "/etc/passwd"])
    def test_safe_join_blocks_traversal(self, tmp_path, rel):
        with pytest.raises(ValueError, match="Path traversal"):
            app_module._safe_join(str(tmp_path), rel)

    def test_headers_without_any_token(self, agent_mock):
        agent_mock.load_repository.return_value = {"accessToken": ""}
        with app_module.app.test_request_context():
            headers = app_module._get_repository_headers("repo-1")
        assert "Authorization" not in headers


# --------------------------------------------------------------- downloads


class TestDownloadGithubContent:
    def test_single_json_file_is_written(self, tmp_path, monkeypatch, fake_response):
        """A file whose body is valid JSON must not be mistaken for a directory listing."""
        body = b'{"key": "value"}'
        monkeypatch.setattr(
            app_module.requests, "get",
            MagicMock(return_value=fake_response(200, json_data={"key": "value"}, content=body)),
        )
        app_module._download_github_content(
            "https://api.github.com/repos/o/r/contents/blocks/config.json?ref=main",
            {}, str(tmp_path),
        )
        assert (tmp_path / "config.json").read_bytes() == body

    def test_single_plain_file(self, tmp_path, monkeypatch, fake_response):
        monkeypatch.setattr(
            app_module.requests, "get",
            MagicMock(return_value=fake_response(200, text="package a;", content=b"package a;")),
        )
        app_module._download_github_content(
            "https://api.github.com/repos/o/r/contents/blocks/A.mon?ref=main", {}, str(tmp_path)
        )
        assert (tmp_path / "A.mon").read_text() == "package a;"

    def test_directory_listing_downloads_files_and_strips_root(self, tmp_path, monkeypatch, fake_response):
        listing = [
            {"type": "file", "path": "blocks/A.mon", "download_url": "https://raw/A.mon", "url": "u"},
            {"type": "file", "path": "blocks/B.mon", "download_url": "https://raw/B.mon", "url": "u"},
        ]
        files = {
            "https://raw/A.mon": fake_response(200, text="a", content=b"a"),
            "https://raw/B.mon": fake_response(200, text="b", content=b"b"),
        }

        def fake_get(url, **kw):
            if url in files:
                return files[url]
            return fake_response(200, json_data=listing)

        monkeypatch.setattr(app_module.requests, "get", fake_get)
        app_module._download_github_content("https://api.github.com/x", {}, str(tmp_path))
        assert (tmp_path / "A.mon").read_bytes() == b"a"
        assert (tmp_path / "B.mon").read_bytes() == b"b"


class TestDownloadDirectoryViaTree:
    def _tree(self, entries, truncated=False):
        return {"tree": entries, "truncated": truncated}

    def test_downloads_only_files_under_prefix(self, tmp_path, monkeypatch, fake_response):
        tree = self._tree([
            {"type": "blob", "path": "blocks/A.mon"},
            {"type": "blob", "path": "blocks/sub/B.mon"},
            {"type": "blob", "path": "other/C.mon"},
            {"type": "blob", "path": "blocks2/D.mon"},      # prefix look-alike
            {"type": "tree", "path": "blocks/sub"},
        ])
        requested = []

        def fake_get(url, **kw):
            requested.append(url)
            if "git/trees" in url:
                return fake_response(200, json_data=tree)
            return fake_response(200, content=b"x")

        monkeypatch.setattr(app_module.requests, "get", fake_get)
        app_module._download_directory_via_tree("o", "r", "main", "blocks", {"Authorization": "Bearer t"}, str(tmp_path))

        assert (tmp_path / "A.mon").exists()
        assert (tmp_path / "sub" / "B.mon").exists()
        assert not (tmp_path / "C.mon").exists()
        assert not (tmp_path / "D.mon").exists()
        assert len(requested) == 3  # tree + 2 files

    def test_raises_when_nothing_found(self, tmp_path, monkeypatch, fake_response):
        monkeypatch.setattr(
            app_module.requests, "get",
            MagicMock(return_value=fake_response(200, json_data=self._tree([]))),
        )
        with pytest.raises(ValueError, match="No files found"):
            app_module._download_directory_via_tree("o", "r", "main", "blocks", {}, str(tmp_path))

    def test_blocks_path_traversal_from_remote(self, tmp_path, monkeypatch, fake_response):
        tree = self._tree([{"type": "blob", "path": "blocks/../../evil"}])
        monkeypatch.setattr(
            app_module.requests, "get",
            MagicMock(return_value=fake_response(200, json_data=tree)),
        )
        with pytest.raises(ValueError, match="Path traversal"):
            app_module._download_directory_via_tree("o", "r", "main", "blocks", {}, str(tmp_path))


# ----------------------------------------------------------- extension creation


@pytest.fixture
def build_env(monkeypatch, fake_response):
    """Stub the SDK build and GitHub download so the whole pipeline runs offline."""

    def fake_download(url, headers, work_dir):
        with open(f"{work_dir}/A.mon", "w") as f:
            f.write("package a;")

    def fake_build(work_dir, name):
        path = f"{work_dir}/{name}.zip"
        with open(path, "wb") as f:
            f.write(b"PK-zip")
        return path

    monkeypatch.setattr(app_module, "_download_full_repository", fake_download)
    monkeypatch.setattr(app_module, "_download_github_content", lambda url, headers, work_dir, *a, **k: fake_download(url, headers, work_dir))
    monkeypatch.setattr(app_module, "_build_extension", fake_build)


class TestExtensionFromRepository:
    URL = "/extension/repository"

    def test_validates_name(self, client):
        resp = client.post(self.URL, json={"extension_name": "bad name", "repository": {"id": "r"}})
        assert resp.status_code == 400

    def test_requires_repository(self, client):
        assert client.post(self.URL, json={"extension_name": "ok"}).status_code == 400

    def test_non_json_body_is_400(self, client):
        assert client.post(self.URL, data="x", content_type="text/plain").status_code == 400

    def test_unknown_repository_is_404(self, client, agent_mock):
        agent_mock.load_repository.return_value = None
        resp = client.post(self.URL, json={"extension_name": "ok", "repository": {"id": "r"}})
        assert resp.status_code == 404

    def test_download_mode_returns_zip(self, client, agent_mock, build_env):
        agent_mock.load_repository.return_value = REPO
        resp = client.post(self.URL, json={"extension_name": "MyExt", "repository": {"id": "repo-1"}})
        assert resp.status_code == 200
        assert resp.mimetype == "application/zip"
        assert resp.data == b"PK-zip"
        assert "MyExt.zip" in resp.headers["Content-Disposition"]
        agent_mock.upload_extension.assert_not_called()

    def test_upload_mode(self, client, agent_mock, build_env):
        agent_mock.load_repository.return_value = REPO
        agent_mock.upload_extension.return_value = "123"
        resp = client.post(
            self.URL,
            json={"extension_name": "MyExt", "repository": {"id": "repo-1"}, "upload": True},
        )
        assert resp.status_code == 201
        assert resp.get_json() == {"id": "123", "message": "Extension uploaded"}
        _, name, _, build_info = agent_mock.upload_extension.call_args.args
        assert name == "MyExt"
        assert build_info["build_type"] == "repository"
        agent_mock.restart_cep.assert_not_called()

    def test_deploy_restarts_cep(self, client, agent_mock, build_env):
        agent_mock.load_repository.return_value = REPO
        agent_mock.upload_extension.return_value = "1"
        client.post(
            self.URL,
            json={"extension_name": "E", "repository": {"id": "r"}, "upload": True, "deploy": True},
        )
        agent_mock.restart_cep.assert_called_once()

    def test_rebuild_without_existing_extension_is_404(self, client, agent_mock, build_env):
        agent_mock.load_repository.return_value = REPO
        agent_mock.delete_extension.return_value = 0
        resp = client.post(
            self.URL,
            json={"extension_name": "E", "repository": {"id": "r"}, "upload": True, "rebuild": True},
        )
        assert resp.status_code == 404
        agent_mock.upload_extension.assert_not_called()

    def test_rebuild_delete_failure_is_400(self, client, agent_mock, build_env):
        agent_mock.load_repository.return_value = REPO
        agent_mock.delete_extension.side_effect = C8YAgentError("boom")
        resp = client.post(
            self.URL,
            json={"extension_name": "E", "repository": {"id": "r"}, "rebuild": True},
        )
        assert resp.status_code == 400

    def test_rebuild_deletes_then_uploads(self, client, agent_mock, build_env):
        agent_mock.load_repository.return_value = REPO
        agent_mock.delete_extension.return_value = 1
        agent_mock.upload_extension.return_value = "9"
        resp = client.post(
            self.URL,
            json={"extension_name": "E", "repository": {"id": "r"}, "upload": True, "rebuild": True},
        )
        assert resp.status_code == 201
        agent_mock.delete_extension.assert_called_once()

    def test_download_failure_is_400(self, client, agent_mock, monkeypatch):
        agent_mock.load_repository.return_value = REPO
        monkeypatch.setattr(
            app_module, "_download_full_repository", MagicMock(side_effect=RuntimeError("gh down"))
        )
        resp = client.post(self.URL, json={"extension_name": "E", "repository": {"id": "r"}})
        assert resp.status_code == 400
        assert "gh down" in resp.get_json()["error"]

    def test_build_failure_is_500(self, client, agent_mock, monkeypatch, build_env):
        agent_mock.load_repository.return_value = REPO
        monkeypatch.setattr(
            app_module, "_build_extension",
            MagicMock(side_effect=subprocess.CalledProcessError(1, "sdk", stderr="compile error")),
        )
        resp = client.post(self.URL, json={"extension_name": "E", "repository": {"id": "r"}})
        assert resp.status_code == 500
        assert "compile error" in resp.get_json()["error"]

    def test_upload_failure_is_500(self, client, agent_mock, build_env):
        agent_mock.load_repository.return_value = REPO
        agent_mock.upload_extension.side_effect = C8YAgentError("c8y down")
        resp = client.post(
            self.URL, json={"extension_name": "E", "repository": {"id": "r"}, "upload": True}
        )
        assert resp.status_code == 500


class TestExtensionFromList:
    URL = "/extension/list"

    def _body(self, **extra):
        return {
            "extension_name": "E",
            "repository": {"id": "r"},
            "monitors": [{"url": "https://api.github.com/repos/o/r/contents/blocks/A.mon?ref=main", "name": "A", "type": "file"}],
            **extra,
        }

    @pytest.mark.parametrize("monitors", [[], [{}, {}]])
    def test_requires_exactly_one_monitor(self, client, monitors):
        body = self._body()
        body["monitors"] = monitors
        assert client.post(self.URL, json=body).status_code == 400

    @pytest.mark.parametrize("monitor", [
        None,
        "x",
        {},
        {"url": 5},
        {"url": "https://evil.example.com/o/r/contents/A.mon"},
        {"url": "http://api.github.com/repos/o/r/contents/A.mon"},
        {"url": "https://api.github.com/repos/other/r/contents/A.mon"},
        {"url": "https://api.github.com/repos/o/r/contents/A.mon", "type": "bogus"},
    ])
    def test_rejects_invalid_or_foreign_monitors(self, client, agent_mock, monitor):
        agent_mock.load_repository.return_value = REPO
        resp = client.post(self.URL, json=self._body(monitors=[monitor]))
        assert resp.status_code == 400

    def test_file_upload_records_monitors_in_build_info(self, client, agent_mock, build_env):
        agent_mock.load_repository.return_value = REPO
        agent_mock.upload_extension.return_value = "7"
        resp = client.post(self.URL, json=self._body(upload=True))
        assert resp.status_code == 201
        build_info = agent_mock.upload_extension.call_args.args[3]
        assert build_info["build_type"] == "list"
        assert build_info["monitors"][0]["name"] == "A"

    def test_dir_uses_tree_download(self, client, agent_mock, build_env, monkeypatch):
        agent_mock.load_repository.return_value = REPO
        tree = MagicMock()
        monkeypatch.setattr(app_module, "_download_directory_via_tree", tree)
        body = self._body()
        body["monitors"] = [{
            "url": "https://api.github.com/repos/o/r/contents/blocks/sub?ref=dev",
            "name": "sub", "type": "dir",
        }]
        client.post(self.URL, json=body)
        assert tree.call_args.args[:4] == ("o", "r", "dev", "blocks/sub")


class TestExtensionFromYaml:
    URL = "/extension/yaml"
    YAML = "Alpha:\n  files:\n    - a.mon\nBeta:\n  files:\n    - b.mon\nEmpty:\n  files: []\n"

    @pytest.fixture(autouse=True)
    def _env(self, agent_mock, build_env, monkeypatch, fake_response):
        agent_mock.load_repository.return_value = REPO
        agent_mock.upload_extension.side_effect = lambda *a, **k: f"id-{a[1]}"
        agent_mock.delete_extension.return_value = 1
        self.agent = agent_mock
        self.yaml_text = self.YAML
        monkeypatch.setattr(
            app_module.requests, "get",
            lambda url, **kw: fake_response(200, text=self.yaml_text),
        )

    def _post(self, client, **extra):
        body = {
            "yaml": {"url": "https://raw.githubusercontent.com/o/r/main/extensions.yaml"},
            "repository": {"id": "r"},
            **extra,
        }
        return client.post(self.URL, json=body)

    def test_requires_yaml_url(self, client):
        assert client.post(self.URL, json={"repository": {"id": "r"}}).status_code == 400

    def test_requires_repository(self, client):
        assert client.post(self.URL, json={"yaml": {"url": "u"}}).status_code == 400

    def test_unknown_repository(self, client):
        self.agent.load_repository.return_value = None
        assert self._post(client).status_code == 404

    def test_invalid_yaml_structure(self, client):
        self.yaml_text = "- just\n- a list\n"
        assert self._post(client).status_code == 400

    def test_upload_all_sections_skips_empty_section(self, client):
        resp = self._post(client, upload=True)
        assert resp.status_code == 201
        assert resp.get_json() == {
            "uploaded_extensions": [
                {"name": "Alpha", "id": "id-Alpha"},
                {"name": "Beta", "id": "id-Beta"},
            ]
        }

    def test_upload_selected_sections_only(self, client):
        resp = self._post(client, upload=True, sections=["Beta"])
        assert [e["name"] for e in resp.get_json()["uploaded_extensions"]] == ["Beta"]

    def test_unknown_sections_are_ignored(self, client):
        assert self._post(client, upload=True, sections=["Nope"]).status_code == 400

    def test_deploy_restarts_cep_once_after_all_sections(self, client):
        self._post(client, upload=True, deploy=True)
        self.agent.restart_cep.assert_called_once()

    def test_partial_failure_is_207(self, client):
        self.agent.upload_extension.side_effect = [
            "id-1", C8YAgentError("c8y says no"),
        ]
        resp = self._post(client, upload=True)
        assert resp.status_code == 207
        body = resp.get_json()
        assert len(body["uploaded_extensions"]) == 1
        assert body["failed_sections"][0]["section"] == "Beta"
        assert "1 succeeded, 1 failed" in body["message"]

    def test_all_failed_is_400_and_no_restart(self, client):
        self.agent.upload_extension.side_effect = C8YAgentError("no")
        resp = self._post(client, upload=True, deploy=True)
        assert resp.status_code == 400
        self.agent.restart_cep.assert_not_called()

    def test_invalid_section_name_is_reported(self, client):
        self.yaml_text = "'bad name':\n  files: [a.mon]\nGood:\n  files: [b.mon]\n"
        resp = self._post(client, upload=True)
        assert resp.status_code == 207
        assert resp.get_json()["failed_sections"][0]["section"] == "bad name"

    def test_rebuild_without_existing_extension_fails_that_section(self, client):
        self.agent.delete_extension.side_effect = [1, 0]
        resp = self._post(client, upload=True, rebuild=True)
        assert resp.status_code == 207
        assert resp.get_json()["failed_sections"][0]["section"] == "Beta"

    def test_download_mode_returns_first_section_zip(self, client):
        resp = self._post(client)
        assert resp.status_code == 200
        assert "Alpha.zip" in resp.headers["Content-Disposition"]

    def test_download_mode_skips_leading_empty_section(self, client):
        self.yaml_text = "Empty:\n  files: []\nBeta:\n  files: [b.mon]\n"
        resp = self._post(client)
        assert resp.status_code == 200
        assert "Beta.zip" in resp.headers["Content-Disposition"]


# ------------------------------------------------------------------ deletion


class TestDeleteExtension:
    def test_by_id(self, client, agent_mock):
        resp = client.delete("/extension/123")
        assert resp.status_code == 200
        agent_mock.delete_extension.assert_called_once()
        assert agent_mock.delete_extension.call_args.kwargs == {"extension_id": "123"}

    def test_by_id_not_found(self, client, agent_mock):
        agent_mock.delete_extension.side_effect = C8YAgentError("not found")
        assert client.delete("/extension/123").status_code == 404

    def test_by_name_requires_name(self, client):
        assert client.delete("/extension").status_code == 400

    def test_by_name(self, client, agent_mock):
        agent_mock.delete_extension.return_value = 2
        resp = client.delete("/extension?name=Foo")
        assert resp.status_code == 200
        assert resp.get_json()["deleted_count"] == 2

    def test_by_name_none_found(self, client, agent_mock):
        agent_mock.delete_extension.return_value = 0
        assert client.delete("/extension?name=Foo").status_code == 404

    def test_by_name_agent_error_is_500(self, client, agent_mock):
        agent_mock.delete_extension.side_effect = C8YAgentError("x")
        assert client.delete("/extension?name=Foo").status_code == 500
