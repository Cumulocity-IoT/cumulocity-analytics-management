"""
Flask API for managing Cumulocity extensions and repositories.
"""

import base64
import io
import logging
import os
import subprocess
import tempfile
import urllib.parse
from typing import Dict, Optional

import requests
import yaml
from flask import Flask, request, send_file, make_response, jsonify

from c8y_agent import C8YAgent
from solution_utils import (
    handle_errors,
    create_error_response,
    github_web_url_to_content_api,
    parse_boolean,
    remove_root_folders,
    extract_raw_path,
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] %(levelname)s [%(name)s.%(funcName)s:%(lineno)d] %(message)s",
    datefmt="%d/%b/%Y %H:%M:%S",
)
logger = logging.getLogger(__name__)

app = Flask(__name__)
agent = C8YAgent()


@app.route("/health")
def health():
    """Health check endpoint."""
    return jsonify({"status": "UP"}), 200


@app.route("/repository/contentList", methods=["GET"])
@handle_errors
def get_content_list():
    """
    Retrieve repository content list from GitHub.

    Query Parameters:
        url: Encoded repository URL
        repository_id: Optional repository ID for authentication

    Returns:
        JSON list of contents
    """
    encoded_url = request.args.get("url")
    repository_id = request.args.get("repository_id")

    if not encoded_url:
        return create_error_response("URL parameter is required", 400)

    headers = get_repository_headers(request, repository_id)
    decoded_url = urllib.parse.unquote(encoded_url)
    content_url = github_web_url_to_content_api(decoded_url)

    logger.info(f"Fetching content list from: {content_url}")

    response = requests.get(content_url, headers=headers, allow_redirects=True, timeout=30)
    response.raise_for_status()

    return make_response(response.content, 200, {"Content-Type": "application/json"})


@app.route("/repository/content", methods=["GET"])
@handle_errors
def get_content():
    """
    Download content from GitHub repository.

    Query Parameters:
        url: Content URL
        extract_fqn_cep_block: Extract FQN from monitor file
        cep_block_name: Block name for FQN extraction
        repository_id: Repository ID for authentication

    Returns:
        File content or FQN string
    """
    encoded_url = request.args.get("url")
    cep_block_name = request.args.get("cep_block_name")
    repository_id = request.args.get("repository_id")
    extract_fqn = parse_boolean(request.args.get("extract_fqn_cep_block", False))

    if not encoded_url:
        return create_error_response("URL parameter is required", 400)

    headers = get_repository_headers(request, repository_id)
    decoded_url = urllib.parse.unquote(encoded_url)

    response = requests.get(decoded_url, headers=headers, allow_redirects=True, timeout=30)
    response.raise_for_status()

    if extract_fqn:
        if not cep_block_name:
            return create_error_response("cep_block_name required for FQN extraction", 400)

        # Extract package name using regex
        import re
        package_match = re.search(r"package\s+([\w.]+)\s*;", response.text)
        if not package_match:
            return create_error_response("Package name not found in monitor file", 400)

        fqn = f"{package_match.group(1)}.{cep_block_name}"
        return make_response(fqn, 200, {"Content-Type": "text/plain"})

    return make_response(response.content, 200, {"Content-Type": "text/plain"})


@app.route("/repository/configuration", methods=["GET"])
@handle_errors
def load_repositories():
    """Load all configured repositories."""
    result = agent.load_repositories(request)
    return jsonify(result), 200


@app.route("/repository/configuration", methods=["POST"])
@handle_errors
def update_repositories():
    """
    Update repository configurations.

    Request Body:
        List of repository objects with id, name, url fields
    """
    repositories = request.get_json()

    if not isinstance(repositories, list):
        return create_error_response("Request body must be an array", 400)

    required_fields = {"id", "name", "url"}
    for repo in repositories:
        if not all(field in repo for field in required_fields):
            return create_error_response(
                "Each repository must have id, name, and url", 400
            )

    return agent.update_repositories(request, repositories)


def download_github_content(
    url: str,
    headers: Dict[str, str],
    work_dir: str,
    skip_root_folder: bool = True,
    item: Optional[Dict] = None,
) -> None:
    """
    Recursively download content from GitHub.

    Args:
        url: GitHub API URL
        headers: Request headers
        work_dir: Target directory
        skip_root_folder: Remove root folder from paths
        item: Specific item to download (for recursion)
    """
    if item is None:
        logger.info(f"Fetching contents from {url}")
        response = requests.get(url, headers=headers, allow_redirects=True, timeout=30)
        response.raise_for_status()

        try:
            content_response = response.json()

            if isinstance(content_response, list):
                for content_item in content_response:
                    if skip_root_folder:
                        content_item["path"] = remove_root_folders(content_item["path"], 1)
                    download_github_content(url, headers, work_dir, skip_root_folder, content_item)
            else:
                logger.warning(f"Unexpected content format from {url}")
            return
        except ValueError:
            # Single file response
            file_name = extract_raw_path(url)
            full_path = os.path.join(work_dir, file_name)
            with open(full_path, "wb") as f:
                f.write(response.content)
            logger.info(f"Saved single file to {full_path}")
            return

    # Process specific item
    item_path = item.get("path", "")
    item_type = item.get("type", "")
    item_url = item.get("url", "")
    download_url = item.get("download_url")

    logger.info(f"Processing {item_type}: {item_path}")

    relative_path = remove_root_folders(item_path, 1) if skip_root_folder else item_path
    full_path = os.path.join(work_dir, relative_path)

    if item_type == "file":
        os.makedirs(os.path.dirname(full_path), exist_ok=True)

        if download_url:
            response = requests.get(download_url, headers=headers, allow_redirects=True, timeout=30)
            response.raise_for_status()
            content = response.content
        else:
            response = requests.get(item_url, headers=headers, allow_redirects=True, timeout=30)
            response.raise_for_status()

            try:
                content_data = response.json()
                if isinstance(content_data, dict) and "content" in content_data:
                    content = base64.b64decode(content_data["content"])
                else:
                    content = response.content
            except ValueError:
                content = response.content

        with open(full_path, "wb") as f:
            f.write(content)
        logger.info(f"Saved file to {full_path}")

    elif item_type == "dir":
        os.makedirs(full_path, exist_ok=True)
        logger.info(f"Created directory: {full_path}")

        response = requests.get(item_url, headers=headers, allow_redirects=True, timeout=30)
        response.raise_for_status()
        dir_contents = response.json()

        if isinstance(dir_contents, list):
            for dir_item in dir_contents:
                if skip_root_folder:
                    dir_item["path"] = remove_root_folders(dir_item["path"], 1)
                download_github_content(url, headers, work_dir, skip_root_folder, dir_item)


def build_extension(work_dir: str, extension_name: str) -> str:
    """
    Build an Apama extension.

    Args:
        work_dir: Working directory with source files
        extension_name: Name of the extension

    Returns:
        Path to built extension file

    Raises:
        subprocess.CalledProcessError: If build fails
    """
    extension_file = f"{extension_name}.zip"
    extension_path = os.path.join(work_dir, extension_file)

    subprocess.run(
        [
            "/apama_work/apama-analytics-builder-block-sdk/analytics_builder",
            "build",
            "extension",
            "--input",
            work_dir,
            "--output",
            extension_path,
        ],
        check=True,
        capture_output=True,
        text=True,
    )

    return extension_path


@app.route("/extension/repository", methods=["POST"])
@handle_errors
def create_extension():
    """
    Create extension from entire repository.

    Request Body:
        extension_name: Name for the extension
        repository: Repository object
        upload: Whether to upload to Cumulocity
        deploy: Whether to restart CEP after upload
    """
    data = request.get_json()
    extension_name = data.get("extension_name")
    repository = data.get("repository")
    upload = data.get("upload", False)
    deploy = data.get("deploy", False)

    if not extension_name:
        return create_error_response("extension_name is required", 400)
    if not repository or not repository.get("id"):
        return create_error_response("repository with id is required", 400)

    repo_config = agent.load_repository(
        request=request, repository_id=repository["id"], replace_access_token=False
    )

    if not repo_config:
        return create_error_response("Repository not found", 404)

    with tempfile.TemporaryDirectory() as work_dir:
        try:
            headers = get_repository_headers(request, repo_config["id"])
            api_url = github_web_url_to_content_api(repo_config["url"])
            download_github_content(api_url, headers, work_dir)
        except Exception as e:
            logger.error(f"Download failed: {e}", exc_info=True)
            return create_error_response(f"Failed to download content: {e}", 400)

        try:
            extension_path = build_extension(work_dir, extension_name)
        except subprocess.CalledProcessError as e:
            logger.error(f"Build failed: {e.stderr}", exc_info=True)
            return create_error_response(f"Build failed: {e.stderr}", 500)

        try:
            with open(extension_path, "rb") as ext_file:
                if not upload:
                    return send_file(
                        io.BytesIO(ext_file.read()),
                        mimetype="application/zip",
                        as_attachment=True,
                        download_name=f"{extension_name}.zip",
                    )
                else:
                    ext_id = agent.upload_extension(request, extension_name, ext_file)
                    logger.info(f"Uploaded extension {extension_name} as {ext_id}")

                    if deploy:
                        agent.restart_cep(request)

                    return jsonify({"id": ext_id, "message": "Extension uploaded"}), 201
        except Exception as e:
            logger.error(f"Processing failed: {e}", exc_info=True)
            return create_error_response(f"Failed to process extension: {e}", 500)


@app.route("/extension/yaml", methods=["POST"])
@handle_errors
def create_extension_from_yaml():
    """
    Create extensions from YAML specification.

    Request Body:
        yaml: YAML file reference
        sections: Sections to include (empty = all)
        repository: Repository object
        upload: Whether to upload
        deploy: Whether to restart CEP
    """
    data = request.get_json()
    yaml_data = data.get("yaml", {})
    sections = data.get("sections", [])
    repository = data.get("repository")
    upload = data.get("upload", False)
    deploy = data.get("deploy", False)

    if not yaml_data or not yaml_data.get("url"):
        return create_error_response("yaml with url is required", 400)
    if not repository or not repository.get("id"):
        return create_error_response("repository with id is required", 400)

    repo_config = agent.load_repository(
        request=request, repository_id=repository["id"], replace_access_token=False
    )

    if not repo_config:
        return create_error_response("Repository not found", 404)

    base_url = repo_config["url"]
    headers = get_repository_headers(request, repo_config["id"])

    try:
        yaml_url = yaml_data["url"]
        response = requests.get(yaml_url, headers=headers, allow_redirects=True, timeout=30)
        response.raise_for_status()
        yaml_structure = yaml.safe_load(response.text)

        if not yaml_structure or not isinstance(yaml_structure, dict):
            return create_error_response("Invalid YAML structure", 400)

        sections_to_process = sections if sections else list(yaml_structure.keys())
        sections_to_process = [s for s in sections_to_process if s in yaml_structure]

    except Exception as e:
        logger.error(f"YAML fetch/parse error: {e}", exc_info=True)
        return create_error_response(f"Failed to process YAML: {e}", 400)

    uploaded_extensions = []

    for idx, section_name in enumerate(sections_to_process):
        section_data = yaml_structure[section_name]

        if "files" not in section_data or not isinstance(section_data["files"], list):
            logger.warning(f"Section '{section_name}' has no valid 'files' list")
            continue

        files = section_data["files"]
        logger.info(f"Processing section '{section_name}' with {len(files)} files")

        with tempfile.TemporaryDirectory() as work_dir:
            try:
                for file_path in files:
                    file_url = f"{base_url}/{file_path}"
                    api_url = github_web_url_to_content_api(file_url)
                    download_github_content(api_url, headers, work_dir, skip_root_folder=False)
            except Exception as e:
                logger.error(f"Download failed for section '{section_name}': {e}", exc_info=True)
                return create_error_response(f"Download failed for '{section_name}': {e}", 400)

            try:
                extension_path = build_extension(work_dir, section_name)
            except subprocess.CalledProcessError as e:
                logger.error(f"Build failed for '{section_name}': {e.stderr}", exc_info=True)
                return create_error_response(f"Build failed for '{section_name}': {e.stderr}", 500)

            try:
                with open(extension_path, "rb") as ext_file:
                    if not upload:
                        if idx == 0:  # Return first extension
                            return send_file(
                                io.BytesIO(ext_file.read()),
                                mimetype="application/zip",
                                as_attachment=True,
                                download_name=f"{section_name}.zip",
                            )
                    else:
                        ext_id = agent.upload_extension(request, section_name, ext_file)
                        logger.info(f"Uploaded extension {section_name} as {ext_id}")
                        uploaded_extensions.append({"name": section_name, "id": ext_id})

                        is_last = idx == len(sections_to_process) - 1
                        if deploy and is_last:
                            agent.restart_cep(request)

            except Exception as e:
                logger.error(f"Processing failed for '{section_name}': {e}", exc_info=True)
                return create_error_response(f"Processing failed for '{section_name}': {e}", 500)

    if upload:
        return jsonify({"uploaded_extensions": uploaded_extensions}), 201
    else:
        return create_error_response("No valid sections found", 400)


@app.route("/extension/list", methods=["POST"])
@handle_errors
def create_extension_from_list():
    """
    Create extension from list of files.

    Request Body:
        extension_name: Extension name
        monitors: List with single monitor/directory
        repository: Repository object
        upload: Whether to upload
        deploy: Whether to restart CEP
    """
    data = request.get_json()
    extension_name = data.get("extension_name")
    monitors = data.get("monitors", [])
    repository = data.get("repository")
    upload = data.get("upload", False)
    deploy = data.get("deploy", False)

    if not extension_name:
        return create_error_response("extension_name is required", 400)
    if len(monitors) != 1:
        return create_error_response("Exactly one monitor is required", 400)
    if not repository or not repository.get("id"):
        return create_error_response("repository with id is required", 400)

    repo_config = agent.load_repository(
        request=request, repository_id=repository["id"], replace_access_token=False
    )

    if not repo_config:
        return create_error_response("Repository not found", 404)

    with tempfile.TemporaryDirectory() as work_dir:
        try:
            headers = get_repository_headers(request, repo_config["id"])
            api_url = monitors[0]["url"]
            download_github_content(api_url, headers, work_dir)
        except Exception as e:
            logger.error(f"Download failed: {e}", exc_info=True)
            return create_error_response(f"Download failed: {e}", 400)

        try:
            extension_path = build_extension(work_dir, extension_name)
        except subprocess.CalledProcessError as e:
            logger.error(f"Build failed: {e.stderr}", exc_info=True)
            return create_error_response(f"Build failed: {e.stderr}", 500)

        try:
            with open(extension_path, "rb") as ext_file:
                if not upload:
                    return send_file(
                        io.BytesIO(ext_file.read()),
                        mimetype="application/zip",
                        as_attachment=True,
                        download_name=f"{extension_name}.zip",
                    )
                else:
                    ext_id = agent.upload_extension(request, extension_name, ext_file)
                    logger.info(f"Uploaded extension {extension_name} as {ext_id}")

                    if deploy:
                        agent.restart_cep(request)

                    return jsonify({"id": ext_id, "message": "Extension uploaded"}), 201
        except Exception as e:
            logger.error(f"Processing failed: {e}", exc_info=True)
            return create_error_response(f"Failed to process extension: {e}", 500)


@app.route("/cep/id", methods=["GET"])
@handle_errors
def get_cep_operationobject_id():
    """Get CEP operation object ID."""
    result = agent.get_cep_operationobject_id(request)
    if result is None:
        return create_error_response("CEP operation object not found", 404)
    return jsonify(result), 200


@app.route("/cep/status", methods=["GET"])
@handle_errors
def get_cep_ctrl_status():
    """Get CEP control status."""
    result = agent.get_cep_ctrl_status(request)
    if result is None:
        return create_error_response("CEP control status not found", 404)
    return jsonify(result), 200


def get_repository_headers(
    request, repository_id: Optional[str] = None
) -> Dict[str, str]:
    """
    Get headers for GitHub API requests with authentication.

    Args:
        request: Flask request object
        repository_id: Optional repository ID

    Returns:
        Headers dictionary
    """
    headers = {"Accept": "application/vnd.github.v3.raw"}

    if repository_id:
        repo_config = agent.load_repository(
            request=request, repository_id=repository_id, replace_access_token=False
        )
        if repo_config and repo_config.get("accessToken"):
            headers["Authorization"] = f"Bearer {repo_config['accessToken']}"
            logger.debug("Added access token to headers")

    return headers


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=80, debug=False)