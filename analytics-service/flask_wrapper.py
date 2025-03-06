import requests
from flask import Flask, request, Response, send_file, make_response, jsonify
import logging
import tempfile
import os
import re
import base64
import io
import subprocess
import urllib.parse
from c8y_agent import C8YAgent
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

app = Flask(__name__)
agent = C8YAgent()

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


@app.route("/health")
def health():
    return jsonify({"status": "UP"})


@app.route("/repository/contentList", methods=["GET"])
@handle_errors
def get_content_list():
    """
    Retrieve a list of contents from a specified URL in a repository.

    Args (via query parameters):
        url (str): Encoded URL of the repository content to list
        id (str, optional): Repository ID used to fetch authentication headers

    Returns:
        Response: JSON response containing the list of contents with status code 200
            Content-Type: application/json

    Raises:
        HTTPError: If the request to the repository fails

    Example:
        GET /repository/contentList?url=https%3A%2F%2Fapi.github.com%2Frepos%2Fowner%2Frepo%2Fcontents&id=repo123
    """
    encoded_url = request.args.get("url")
    repository_id = request.args.get("repository_id")
    headers = {"Accept": "application/json"}

    if repository_id:
        headers = get_repository_headers(request, repository_id)

    decoded_url = urllib.parse.unquote(encoded_url)
    decoded_content_url = urllib.parse.unquote(
        github_web_url_to_content_api(decoded_url)
    )
    logger.info(f"Getting content list from: {decoded_content_url} {decoded_url}")

    response = requests.get(decoded_content_url, headers=headers, allow_redirects=True)
    response.raise_for_status()

    return make_response(response.content, 200, {"Content-Type": "application/json"})


@app.route("/repository/content", methods=["GET"])
@handle_errors
def get_content():
    """
    Download content from GitHub.

    Args:
        url (str): URL of monitor to download
        extract_fqn_cep_block (bool): Whether to extract the FQN name from the monitor file
        cep_block_name (str): Block name, required to return the FQN name, including the Apama package
        repository_id (str): ID of the repository

    Returns:
        Response: Either the monitor content or FQN name
    """
    encoded_url = request.args.get("url")
    cep_block_name = request.args.get("cep_block_name")
    repository_id = request.args.get("repository_id")
    extract_fqn_cep_block = parse_boolean(
        request.args.get("extract_fqn_cep_block", False)
    )

    headers = get_repository_headers(request, repository_id)
    decoded_url = urllib.parse.unquote(encoded_url)

    response = requests.get(decoded_url, headers=headers, allow_redirects=True)
    response.raise_for_status()

    if extract_fqn_cep_block:
        package = re.findall(r"(package\s)(.*?);", response.text)
        if not package:
            raise ValueError("Package name not found in monitor file")
        fqn = f"{package[0][1]}.{cep_block_name}"
        return make_response(fqn, 200, {"Content-Type": "text/plain"})

    return make_response(response.content, 200, {"Content-Type": "text/plain"})


@app.route("/repository/configuration", methods=["GET"])
@handle_errors
def load_repositories():
    """
    Load the configured repositories.

    Returns:
        Response: JSON list of configured repositories or error response
    """
    result = agent.load_repositories(request)
    if result is None:
        return create_error_response("No repositories found", 404)
    return jsonify(result)


@app.route("/repository/configuration", methods=["POST"])
@handle_errors
def update_repositories():
    """
    Update all the configured repositories.

    Returns:
        Response: Result of the update operation
    """
    repositories = request.get_json()

    # Validate input
    if not isinstance(repositories, list):
        return create_error_response(
            "Request body must be an array of repositories", 400
        )

    # Validate repository format
    required_fields = {"id", "name", "url"}
    for repo in repositories:
        if not all(field in repo for field in required_fields):
            return create_error_response(
                "Each repository must have id, name, and url", 400
            )

    return agent.update_repositories(request, repositories)


def download_github_content(url, headers, work_dir, item=None):
    """
    Download content from GitHub, handling both files and directories.
    If item is provided, it's a specific file/directory to download.
    If not, we fetch the contents at the URL.

    Args:
        url (str): URL pointing to GitHub API endpoint for repository content
        headers (dict): Headers to include in API requests (auth tokens, etc.)
        work_dir (str): Directory to save downloaded content to
        item (dict, optional): Single item to process (used in recursive calls)
    """
    if item is None:
        # No specific item provided, get the contents from the URL
        logger.info(f"Fetching contents from {url}")
        response = requests.get(url, headers=headers, allow_redirects=True)
        response.raise_for_status()

        try:
            content_response = response.json()

            # Check if response is a list of items or a single item
            if isinstance(content_response, list):
                for item in content_response:
                    item["path"] = remove_root_folders(item["path"], 1)
                    download_github_content(url, headers, work_dir, item)
            else:
                logger.warning(f"Unexpected content format from {url}")
            return
        except ValueError:
            # Single file
            file_name = extract_raw_path(url)
            full_path = os.path.join(work_dir, file_name)
            with open(full_path, "wb") as f:
                f.write(response.content)
            logger.info(f"Saving single file {url}, {full_path}")
            return

    # Process a specific item
    item_path = item.get("path", "")
    item_type = item.get("type", "")
    item_url = item.get("url", "")
    download_url = item.get("download_url")

    logger.info(f"Processing {item_type}: {item_path}")

    # Extract relative path by removing left folder name
    relative_path = remove_root_folders(item_path, 1)

    # Full path in the work directory
    full_path = os.path.join(work_dir, relative_path)

    logger.debug(f"Item path: {item_path}")
    logger.debug(f"Relative path: {relative_path}")
    logger.debug(f"Full path: {full_path}")

    if item_type == "file":
        # Create parent directories if they don't exist
        os.makedirs(os.path.dirname(full_path), exist_ok=True)

        # Download file content
        if download_url:
            # Use the direct download URL if available
            logger.info(f"Downloading file from {download_url}")
            file_response = requests.get(
                download_url, headers=headers, allow_redirects=True
            )
            file_response.raise_for_status()

            # Write file content
            with open(full_path, "wb") as f:
                f.write(file_response.content)

            logger.info(f"File downloaded and saved to: {full_path}")
        else:
            # Use the API URL and handle GitHub API response format
            logger.info(f"Fetching file content from API: {item_url}")
            content_response = requests.get(
                item_url, headers=headers, allow_redirects=True
            )
            content_response.raise_for_status()

            try:
                # Try to parse as JSON (GitHub API format)
                content_data = content_response.json()

                if isinstance(content_data, dict) and "content" in content_data:
                    # GitHub API returns base64 encoded content
                    content = base64.b64decode(content_data["content"])

                    with open(full_path, "wb") as f:
                        f.write(content)

                    logger.info(f"File downloaded and saved to: {full_path}")
                else:
                    logger.warning(f"Unexpected content format for file: {item_path}")
            except ValueError:
                # Not JSON, treat as raw content
                with open(full_path, "wb") as f:
                    f.write(content_response.content)

                logger.info(f"Raw content saved to: {full_path}")

    elif item_type == "dir":
        # Create directory if it doesn't exist
        os.makedirs(full_path, exist_ok=True)
        logger.info(f"Created directory: {full_path}")

        # Recursively process directory contents
        dir_response = requests.get(item_url, headers=headers, allow_redirects=True)
        dir_response.raise_for_status()

        dir_contents = dir_response.json()

        # Process each item in the directory
        if isinstance(dir_contents, list):
            for dir_item in dir_contents:
                dir_item["path"] = remove_root_folders(dir_item["path"], 1)
                download_github_content(url, headers, work_dir, dir_item)
        else:
            logger.warning(f"Expected directory listing as a list for {item_path}")

    else:
        logger.warning(f"Unknown item type: {item_type} for {item_path}")


@app.route("/extension/repository", methods=["POST"])
@handle_errors
def create_extension_zip():
    """
    Get details for a specific extension.

    Args:
        name (str):         Name of the extension
        repository (dict):  Repository with extensions
        upload (boolean):   Upload extension
        deploy (boolean):   Deploy/restart Analytics to deploy

    """
    data = request.get_json()
    extension_name = data.get("extension_name")
    repository = data.get("repository")
    upload = data.get("upload", False)
    deploy = data.get("deploy", False)

    if not extension_name:
        return create_error_response("Extension name is required", 400)

    repository_configuration = agent.load_repository(
        request=request, repository_id=repository["id"], replace_access_token=False
    )
    with tempfile.TemporaryDirectory() as work_temp_dir:
        # Download and process monitors
        try:

            headers = get_repository_headers(request, repository_configuration["id"])

            api_url = github_web_url_to_content_api(repository_configuration["url"])
            download_github_content(api_url, headers, work_temp_dir)

        except Exception as e:
            logger.error(
                f"Error downloading monitor: {repository_configuration}", exc_info=True
            )
            return create_error_response(f"Failed to download monitor: {str(e)}", 400)

        # Create extension
        result_extension_file = f"{extension_name}.zip"
        result_extension_absolute = os.path.join(work_temp_dir, result_extension_file)

        try:
            subprocess.run(
                [
                    "/apama_work/apama-analytics-builder-block-sdk/analytics_builder",
                    "build",
                    "extension",
                    "--input",
                    work_temp_dir,
                    "--output",
                    result_extension_absolute,
                ],
                check=True,
            )
        except subprocess.CalledProcessError as e:
            return create_error_response(f"Failed to build extension: {str(e)}", 500)

        # Handle the extension file
        try:
            with open(result_extension_absolute, "rb") as extension_zip:
                if not upload:
                    return send_file(
                        io.BytesIO(extension_zip.read()),
                        mimetype="application/zip",
                        as_attachment=True,
                        download_name=result_extension_file,
                    )
                else:
                    id = agent.upload_extension(request, extension_name, extension_zip)
                    logger.info(f"Uploaded extension {extension_name} as {id}")

                    if deploy:
                        agent.restart_cep(request)

                    return "", 201
        except Exception as e:
            return create_error_response(f"Failed to process extension: {str(e)}", 500)


@app.route("/extension/list", methods=["POST"])
@handle_errors
def create_extension_zip_from_list():
    """
    Get details for a specific extension.

    Args:
        extension_name (str):         Name of the extension
        monitors (list):    List of monitors to include in the extensions
        upload (boolean):   Upload extension
        deploy (boolean):   Deploy/restart Analytics to deploy

    """
    data = request.get_json()
    extension_name = data.get("extension_name")
    monitors = data.get("monitors", [])
    repository = data.get("repository")
    upload = data.get("upload", False)
    deploy = data.get("deploy", False)

    if not extension_name:
        return create_error_response("Extension name is required", 400)

    if len(monitors) != 1:
        return create_error_response("Exactly one item in monitors is required", 400)

    repository_configuration = agent.load_repository(
        request=request, repository_id=repository["id"], replace_access_token=False
    )
    with tempfile.TemporaryDirectory() as work_temp_dir:
        # Download and process monitors
        try:

            headers = get_repository_headers(request, repository_configuration["id"])

            if monitors[0]["type"] == "file":
                api_url = monitors[0]["url"]
                download_github_content(api_url, headers, work_temp_dir)
            else:
                api_url = monitors[0]["url"]
                download_github_content(api_url, headers, work_temp_dir)

        except Exception as e:
            logger.error(
                f"Error downloading monitor: {repository_configuration}", exc_info=True
            )
            return create_error_response(f"Failed to download monitor: {str(e)}", 400)

        # Create extension
        result_extension_file = f"{extension_name}.zip"
        result_extension_absolute = os.path.join(work_temp_dir, result_extension_file)

        try:
            subprocess.run(
                [
                    "/apama_work/apama-analytics-builder-block-sdk/analytics_builder",
                    "build",
                    "extension",
                    "--input",
                    work_temp_dir,
                    "--output",
                    result_extension_absolute,
                ],
                check=True,
            )
        except subprocess.CalledProcessError as e:
            return create_error_response(f"Failed to build extension: {str(e)}", 500)

        # Handle the extension file
        try:
            with open(result_extension_absolute, "rb") as extension_zip:
                if not upload:
                    return send_file(
                        io.BytesIO(extension_zip.read()),
                        mimetype="application/zip",
                        as_attachment=True,
                        download_name=result_extension_file,
                    )
                else:
                    id = agent.upload_extension(request, extension_name, extension_zip)
                    logger.info(f"Uploaded extension {extension_name} as {id}")

                    if deploy:
                        agent.restart_cep(request)

                    return "", 201
        except Exception as e:
            return create_error_response(f"Failed to process extension: {str(e)}", 500)


@app.route("/cep/extension/<name>", methods=["GET"])
@handle_errors
def get_extension(name: str):
    """
    Get details for a specific extension.

    Args:
        name (str): Name of monitor to download

    Returns:
        Response: JSON object containing extension details with the following structure:

        CEP_Extension:
        {
            "name": str,
            "analytics": List[CEP_Block],
            "version": str,
            "loaded": bool
        }

        Where CEP_Block is:
        {
            "id": str,
            "name": str,
            "installed": bool,
            "producesOutput": str,
            "description": str,
            "url": str,
            "downloadUrl": str,
            "path": str,
            "custom": bool,
            "extension": str,
            "repositoryName": str,
            "category": Category
        }
    """
    # Implement actual extension retrieval logic
    cep_extension = {"name": name}  # Placeholder
    return jsonify(cep_extension)


@app.route("/cep/extension", methods=["GET"])
@handle_errors
def get_extension_metadata():
    """
    Get details on all loaded extensions.

    Returns:
        Response: JSON object containing extension metadata with structure:
        {
            "metadatas": List[str],
            "messages": List[str]
        }
    """
    # Implement actual metadata retrieval logic
    cep_extension_metadata = []  # Placeholder
    return jsonify(cep_extension_metadata)


@app.route("/cep/id", methods=["GET"])
@handle_errors
def get_cep_operationobject_id():
    """
    Get the managedObject that represents the CEP ctrl microservice.

    Returns:
        Response: JSON object containing the CEP operation object ID
    """
    result = agent.get_cep_operationobject_id(request)
    if result is None:
        return create_error_response("CEP operation object not found", 404)
    return jsonify(result)


@app.route("/cep/status", methods=["GET"])
@handle_errors
def get_cep_ctrl_status():
    """
    Get the managedObject that represents the CEP ctrl microservice.

    Returns:
        Response: JSON object containing the CEP operation object ID
    """
    result = agent.get_cep_ctrl_status(request)
    if result is None:
        return create_error_response("CEP control status not found", 404)
    return jsonify(result)


# Additional utility functions


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


class ExtensionBuilder:
    """Helper class for building extensions"""

    def __init__(self, work_dir: str, extension_name: str):
        self.work_dir = work_dir
        self.extension_name = extension_name
        self.extension_file = f"{extension_name}.zip"
        self.extension_path = os.path.join(work_dir, self.extension_file)

    def build(self) -> None:
        """Build the extension using analytics_builder"""
        subprocess.run(
            [
                "/apama_work/apama-analytics-builder-block-sdk/analytics_builder",
                "build",
                "extension",
                "--input",
                self.work_dir,
                "--output",
                self.extension_path,
            ],
            check=True,
        )

    def get_file_path(self) -> str:
        """Get the path to the built extension file"""
        return self.extension_path


class MonitorDownloader:
    """Helper class for downloading monitors"""

    @staticmethod
    async def download_monitor(
        url: str, headers: Dict[str, str], target_path: str
    ) -> None:
        """Download a monitor file"""
        response = requests.get(url, headers=headers, allow_redirects=True)
        response.raise_for_status()

        with open(target_path, "wb") as f:
            f.write(response.content)


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


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=80, debug=False)
