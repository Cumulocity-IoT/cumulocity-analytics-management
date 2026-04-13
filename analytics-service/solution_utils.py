"""
Utility functions for solution management, GitHub integration, and error handling.
"""

import json
import logging
from functools import wraps
from typing import Any
from urllib.parse import urlparse, parse_qs

from flask import Response
from requests.exceptions import HTTPError

logger = logging.getLogger(__name__)

DEFAULT_BRANCH = "main"


def handle_errors(f):
    """
    Decorator for handling HTTP and general errors in Flask routes.

    Args:
        f: Function to wrap

    Returns:
        Wrapped function with error handling
    """
    @wraps(f)
    def wrapper(*args, **kwargs):
        try:
            return f(*args, **kwargs)
        except HTTPError as e:
            status_code = e.response.status_code
            logger.error(f"HTTP Error: {status_code}", exc_info=True)
            return create_error_response(str(e), status_code)
        except ValueError as e:
            logger.error(f"Validation error: {e}", exc_info=True)
            return create_error_response(str(e), 400)
        except Exception as e:
            logger.error("Unexpected error", exc_info=True)
            return create_error_response(str(e), 500)

    return wrapper


def create_error_response(message: str, status_code: int) -> Response:
    """
    Create a JSON error response.

    Args:
        message: Error message
        status_code: HTTP status code

    Returns:
        Flask Response object
    """
    return Response(
        json.dumps({"error": message}),
        status=status_code,
        mimetype="application/json",
    )


def github_web_url_to_content_api(github_web_url: str) -> str:
    """
    Transform a GitHub web URL to a GitHub Content API endpoint URL.

    Args:
        github_web_url: GitHub web URL

    Returns:
        GitHub Content API URL

    Raises:
        ValueError: If URL is invalid
    """
    try:
        parsed_url = urlparse(github_web_url)

        if "github.com" not in parsed_url.netloc:
            raise ValueError("Not a GitHub URL")

        path_parts = [part for part in parsed_url.path.split("/") if part]

        if len(path_parts) < 2:
            raise ValueError("Invalid GitHub URL: missing user or repository")

        user, repo = path_parts[0], path_parts[1]
        branch = DEFAULT_BRANCH
        path_in_repo = ""

        if len(path_parts) > 3 and path_parts[2] == "tree":
            branch = path_parts[3]
            path_in_repo = "/".join(path_parts[4:]) if len(path_parts) > 4 else ""
        elif len(path_parts) > 2:
            path_in_repo = "/".join(path_parts[2:])

        content_api_url = f"https://api.github.com/repos/{user}/{repo}/contents"
        if path_in_repo:
            content_api_url += f"/{path_in_repo}"
        content_api_url += f"?ref={branch}"

        return content_api_url

    except Exception as e:
        raise ValueError(f"Failed to convert GitHub URL: {e}")


def content_api_to_github_web_url(content_api_url: str) -> str:
    """
    Transform a GitHub Content API URL to a GitHub web URL.

    Args:
        content_api_url: GitHub Content API URL

    Returns:
        GitHub web URL

    Raises:
        ValueError: If URL is invalid
    """
    try:
        parsed_url = urlparse(content_api_url)

        if "api.github.com" not in parsed_url.netloc:
            raise ValueError("Not a GitHub API URL")

        path_parts = [part for part in parsed_url.path.split("/") if part]

        if (
            len(path_parts) < 4
            or path_parts[0] != "repos"
            or path_parts[3] != "contents"
        ):
            raise ValueError("Invalid GitHub Content API URL format")

        user, repo = path_parts[1], path_parts[2]
        query_params = parse_qs(parsed_url.query)
        branch = query_params.get("ref", [DEFAULT_BRANCH])[0]
        path_in_repo = "/".join(path_parts[4:]) if len(path_parts) > 4 else ""

        github_web_url = f"https://github.com/{user}/{repo}"
        if path_in_repo:
            github_web_url += f"/tree/{branch}/{path_in_repo}"
        else:
            github_web_url += f"/tree/{branch}"

        return github_web_url

    except Exception as e:
        raise ValueError(f"Failed to convert GitHub API URL: {e}")


def extract_relative_path(url_file: str, url_repository: str) -> str:
    """
    Extract relative path from a file URL using repository URL as reference.

    Args:
        url_file: Full URL to the file
        url_repository: URL to the repository

    Returns:
        Relative path
    """
    url_repository = url_repository.rstrip("/")
    url_file = url_file.rstrip("/")

    if url_file.startswith(url_repository):
        relative_path = url_file[len(url_repository):].lstrip("/")
        return relative_path

    return url_file.split("/")[-1]


def parse_boolean(value: Any) -> bool:
    """
    Parse a value to boolean.

    Args:
        value: Value to parse

    Returns:
        Boolean value
    """
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.lower() in ("true", "1", "yes")
    return bool(value)


def extract_raw_path(path: str) -> str:
    """
    Extract filename from path, removing query parameters.

    Args:
        path: File path or URL

    Returns:
        Filename
    """
    path_without_query = path.split("?", 1)[0]
    return path_without_query.rsplit("/", 1)[-1]


def remove_root_folders(item_path: str, n: int) -> str:
    """
    Remove first n folders from path.

    Args:
        item_path: Path to process
        n: Number of folders to remove

    Returns:
        Path with folders removed
    """
    parts = item_path.split("/")
    return "/".join(parts[n:]) if len(parts) > n else ""