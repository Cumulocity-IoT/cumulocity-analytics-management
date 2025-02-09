import requests
from flask import Flask, request, Response, send_file, make_response, jsonify
import logging
import tempfile
import os
import re
import io
import subprocess
import urllib.parse
from c8y_agent import C8YAgent
from requests.exceptions import HTTPError
import json
from functools import wraps
from typing import Dict, Any, Optional

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
                f"token {repository_configuration['accessToken']}"
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
    repository_id = request.args.get("id")
    headers = {"Accept": "application/json"}

    if repository_id:
        headers = get_repository_headers(request, repository_id)

    decoded_url = urllib.parse.unquote(encoded_url)
    logger.info(f"Getting content list from: {decoded_url}")

    response = requests.get(decoded_url, headers=headers, allow_redirects=True)
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


@app.route("/extension", methods=["POST"])
@handle_errors
def create_extension_zip():
    """
    Get details for a specific extension.
    
    Args:
        name (str): Name of the extension
    
    Returns:
        Response: JSON object containing extension details with structure:
        {
            "name": str,
            "analytics": List[{
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
                "category": str
            }],
            "version": str,
            "loaded": bool
        }
    """
    data = request.get_json()
    extension_name = data.get("extension_name")
    monitors = data.get("monitors", [])
    upload = data.get("upload", False)
    deploy = data.get("deploy", False)

    if not extension_name:
        return create_error_response("Extension name is required", 400)

    with tempfile.TemporaryDirectory() as work_temp_dir:
        # Download and process monitors
        for monitor in monitors:
            try:
                file_name = extract_raw_path(monitor["downloadUrl"])
                repository_configuration = agent.load_repository(
                    request=request, repository_id=monitor["repositoryId"], replace_access_token=False
                )

                headers = get_repository_headers(request, monitor["repositoryId"])
                response = requests.get(
                    monitor["url"], headers=headers, allow_redirects=True
                )
                response.raise_for_status()

                file_path = os.path.join(work_temp_dir, file_name)
                with open(file_path, "wb") as f:
                    f.write(response.content)
                logger.info(f"File downloaded and saved to: {file_path}")

            except Exception as e:
                logger.error(f"Error downloading monitor: {monitor}", exc_info=True)
                return create_error_response(
                    f"Failed to download monitor: {str(e)}", 400
                )

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
    return path.rsplit("/", 1)[-1]


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=80, debug=False)
