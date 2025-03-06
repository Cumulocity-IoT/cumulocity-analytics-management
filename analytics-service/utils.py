from flask import Response
import logging
from requests.exceptions import HTTPError
import json
from functools import wraps
from typing import Dict, Any, Optional
from urllib.parse import urlparse, parse_qs

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] %(levelname)s [%(name)s.%(funcName)s:%(lineno)d] %(message)s",
    datefmt="%d/%b/%Y %H:%M:%S",
)
logger = logging.getLogger("flask_wrapper")
logger.setLevel(logging.INFO)

DEFAULT_BRANCH = "main"


# Error handling decorator
def handle_errors(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        try:
            return f(*args, **kwargs)
        except HTTPError as e:
            status_code = e.response.status_code
            logger.error(f"HTTP Error: {status_code}", exc_info=True)
            return create_error_response(str(e), status_code)
        except Exception as e:
            logger.error("Unexpected error", exc_info=True)
            return create_error_response(str(e), 500)

    return wrapper


def create_error_response(message: str, status_code: int) -> Response:
    return Response(
        json.dumps({"message": f"Error: {message}"}),
        status=status_code,
        mimetype="application/json",
    )


def get_repository_headers(
    request, repository_id: Optional[str] = None
) -> Dict[str, str]:
    headers = {"Accept": "application/vnd.github.v3.raw"}
    if repository_id:
        repository_configuration = agent.load_repository(
            request=request, repository_id=repository_id, replace_access_token=False
        )
        if "accessToken" in repository_configuration:
            headers["Authorization"] = (
                f"Bearer {repository_configuration['accessToken']}"
            )
            logger.info("Access token found and added to headers")
    return headers


def github_web_url_to_content_api(github_web_url: str) -> str:
    """
    Transforms a GitHub web URL to a GitHub Content API endpoint URL

    Args:
        github_web_url: A GitHub web URL (e.g., https://github.com/user/repo/tree/branch/path)

    Returns:
        The equivalent GitHub Content API URL

    Raises:
        ValueError: If the URL is not a valid GitHub URL
    """
    try:
        # Parse the URL
        parsed_url = urlparse(github_web_url)

        # Verify it's a GitHub URL
        if "github.com" not in parsed_url.netloc:
            raise ValueError("Not a GitHub URL")

        # Extract repo info from path
        path_parts = [part for part in parsed_url.path.split("/") if part]

        # Need at least user and repo
        if len(path_parts) < 2:
            raise ValueError("Invalid GitHub URL: missing user or repository")

        user = path_parts[0]
        repo = path_parts[1]

        # Check if the URL points to a specific branch/tag/commit
        branch = DEFAULT_BRANCH  # Default branch
        path_in_repo = ""

        if len(path_parts) > 3 and path_parts[2] == "tree":
            branch = path_parts[3]
            path_in_repo = "/".join(path_parts[4:]) if len(path_parts) > 4 else ""
        elif len(path_parts) > 2:
            # URL doesn't specify a branch, assume content is in the root
            path_in_repo = "/".join(path_parts[2:])

        # Build the Content API URL
        content_api_url = f"https://api.github.com/repos/{user}/{repo}/contents"

        if path_in_repo:
            content_api_url += f"/{path_in_repo}"

        content_api_url += f"?ref={branch}"

        return content_api_url

    except Exception as e:
        raise ValueError(f"Failed to convert GitHub URL: {str(e)}")


def content_api_to_github_web_url(content_api_url: str) -> str:
    """
    Transforms a GitHub Content API URL to a GitHub web URL

    Args:
        content_api_url: A GitHub Content API URL

    Returns:
        The equivalent GitHub web URL

    Raises:
        ValueError: If the URL is not a valid GitHub API URL
    """
    try:
        # Parse the URL
        parsed_url = urlparse(content_api_url)

        # Verify it's a GitHub API URL
        if "api.github.com" not in parsed_url.netloc:
            raise ValueError("Not a GitHub API URL")

        # Extract path parts
        path_parts = [part for part in parsed_url.path.split("/") if part]

        # Need at least "repos", user, repo, "contents"
        if (
            len(path_parts) < 4
            or path_parts[0] != "repos"
            or path_parts[3] != "contents"
        ):
            raise ValueError("Invalid GitHub Content API URL format")

        user = path_parts[1]
        repo = path_parts[2]

        # Get the branch from the ref query parameter
        query_params = parse_qs(parsed_url.query)
        branch = query_params.get("ref", [DEFAULT_BRANCH])[0]

        # Extract the path within the repo
        path_in_repo = "/".join(path_parts[4:]) if len(path_parts) > 4 else ""

        # Build the GitHub web URL
        github_web_url = f"https://github.com/{user}/{repo}"

        if path_in_repo:
            github_web_url += f"/tree/{branch}/{path_in_repo}"
        else:
            github_web_url += f"/tree/{branch}"

        return github_web_url

    except Exception as e:
        raise ValueError(f"Failed to convert GitHub API URL: {str(e)}")


def extract_relative_path(url_file, url_repository):
    """
    Extract the relative path from a file URL using a repository URL as reference.

    Args:
        url_file: The full URL to the file
        url_repository: The URL to the repository or base directory

    Returns:
        The file path relative to the repository URL
    """
    # Make sure both URLs end without trailing slash for consistent comparison
    url_repository = url_repository.rstrip("/")
    url_file = url_file.rstrip("/")

    # Check if the file URL starts with the repository URL
    if url_file.startswith(url_repository):
        # Get everything after the repository URL
        relative_path = url_file[len(url_repository) :]
        # Remove leading slash if present
        relative_path = relative_path.lstrip("/")
        return relative_path
    else:
        # If the file URL doesn't start with the repository URL,
        # try extracting the filename from the end of the URL
        return url_file.split("/")[-1]

def parse_boolean(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.lower() == "true"
    return False


def extract_raw_path(path: str) -> str:
    # First split by '?' and take the first part
    path_without_query = path.split("?", 1)[0]
    # Then extract the filename as before
    return path_without_query.rsplit("/", 1)[-1]


def remove_root_folders(item_path: str, n: int) -> str:
    item_path_parts = item_path.split("/")
    if len(item_path_parts) > 1:
        return "/".join(item_path_parts[n:])
    else:
        return ""
