"""Unit tests for solution_utils (pure functions and the error decorator)."""

import json

import pytest
from requests.exceptions import HTTPError

from solution_utils import (
    content_api_to_github_web_url,
    create_error_response,
    extract_raw_path,
    extract_relative_path,
    github_web_url_to_content_api,
    handle_errors,
    parse_boolean,
    parse_github_web_url,
    remove_root_folders,
)


class TestParseGithubWebUrl:
    def test_tree_url_with_path(self):
        assert parse_github_web_url(
            "https://github.com/owner/repo/tree/dev/blocks/sub"
        ) == {"owner": "owner", "repo": "repo", "branch": "dev", "path": "blocks/sub"}

    def test_tree_url_without_path(self):
        result = parse_github_web_url("https://github.com/owner/repo/tree/dev")
        assert result["branch"] == "dev"
        assert result["path"] == ""

    def test_bare_repo_defaults_to_main(self):
        assert parse_github_web_url("https://github.com/owner/repo") == {
            "owner": "owner", "repo": "repo", "branch": "main", "path": "",
        }

    def test_path_without_tree_keyword(self):
        result = parse_github_web_url("https://github.com/owner/repo/blocks/a.mon")
        assert result["branch"] == "main"
        assert result["path"] == "blocks/a.mon"

    @pytest.mark.parametrize(
        "url",
        ["https://example.com/owner/repo", "https://github.com/owner", "not a url"],
    )
    def test_invalid_urls_raise(self, url):
        with pytest.raises(ValueError):
            parse_github_web_url(url)


class TestUrlConversion:
    def test_web_to_content_api(self):
        assert (
            github_web_url_to_content_api("https://github.com/o/r/tree/b/x/y")
            == "https://api.github.com/repos/o/r/contents/x/y?ref=b"
        )

    def test_web_to_content_api_root(self):
        assert (
            github_web_url_to_content_api("https://github.com/o/r")
            == "https://api.github.com/repos/o/r/contents?ref=main"
        )

    def test_content_api_to_web(self):
        assert (
            content_api_to_github_web_url(
                "https://api.github.com/repos/o/r/contents/x/y?ref=b"
            )
            == "https://github.com/o/r/tree/b/x/y"
        )

    def test_content_api_to_web_root_defaults_branch(self):
        assert (
            content_api_to_github_web_url("https://api.github.com/repos/o/r/contents")
            == "https://github.com/o/r/tree/main"
        )

    def test_round_trip(self):
        web = "https://github.com/o/r/tree/feature/blocks"
        assert content_api_to_github_web_url(github_web_url_to_content_api(web)) == web

    @pytest.mark.parametrize(
        "url",
        [
            "https://github.com/o/r/contents/x",
            "https://api.github.com/users/o",
            "https://api.github.com/repos/o/r/issues",
        ],
    )
    def test_content_api_to_web_rejects_other_urls(self, url):
        with pytest.raises(ValueError):
            content_api_to_github_web_url(url)


class TestSmallHelpers:
    @pytest.mark.parametrize(
        "value,expected",
        [
            (True, True), (False, False), ("true", True), ("TRUE", True),
            ("1", True), ("yes", True), ("false", False), ("0", False),
            ("", False), (None, False), (0, False), (2, True),
        ],
    )
    def test_parse_boolean(self, value, expected):
        assert parse_boolean(value) is expected

    def test_extract_raw_path(self):
        assert extract_raw_path("https://x/y/File.mon?ref=main") == "File.mon"
        assert extract_raw_path("File.mon") == "File.mon"

    def test_remove_root_folders(self):
        assert remove_root_folders("blocks/sub/A.mon", 1) == "sub/A.mon"
        assert remove_root_folders("blocks/A.mon", 2) == ""
        assert remove_root_folders("A.mon", 0) == "A.mon"

    def test_extract_relative_path(self):
        assert extract_relative_path("https://r/x/a/b.mon", "https://r/x/") == "a/b.mon"
        assert extract_relative_path("https://other/a/b.mon", "https://r/x") == "b.mon"


class TestErrorHandling:
    def test_create_error_response(self):
        resp = create_error_response("boom", 418)
        assert resp.status_code == 418
        assert resp.mimetype == "application/json"
        assert json.loads(resp.get_data(as_text=True)) == {"error": "boom"}

    def test_handle_errors_passes_through(self):
        @handle_errors
        def ok():
            return "fine"

        assert ok() == "fine"

    def test_handle_errors_maps_value_error_to_400(self):
        @handle_errors
        def bad():
            raise ValueError("nope")

        assert bad().status_code == 400

    def test_handle_errors_maps_http_error_status(self):
        class _R:
            status_code = 404

        @handle_errors
        def bad():
            raise HTTPError("missing", response=_R())

        assert bad().status_code == 404

    def test_handle_errors_maps_unexpected_to_500(self):
        @handle_errors
        def bad():
            raise RuntimeError("kaboom")

        resp = bad()
        assert resp.status_code == 500
        assert "kaboom" in resp.get_data(as_text=True)
