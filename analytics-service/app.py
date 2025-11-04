"""
Flask API for managing Cumulocity extensions and repositories.
"""

import io
import logging
import os
import re
import subprocess
import tempfile
import urllib.parse
from typing import Dict, List, Optional

import requests
import yaml
from flask import Flask, jsonify, make_response, request, send_file

from c8y_agent import C8YAgent, C8YAgentError
from solution_utils import (
    create_error_response,
    github_web_url_to_content_api,
    handle_errors,
    parse_boolean,
    remove_root_folders,
    extract_raw_path,
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] %(levelname)s [%(name)s.%(funcName)s:%(lineno)d] %(message)s",
)
logger = logging.getLogger(__name__)

app = Flask(__name__)
agent = C8YAgent()


# ============================================================================
# Health & Status Endpoints
# ============================================================================


@app.route("/health")
def health():
    """Health check endpoint."""
    return jsonify({"status": "UP"}), 200


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


# ============================================================================
# Repository Configuration
# ============================================================================


@app.route("/repository/configuration", methods=["GET"])
@handle_errors
def load_repositories():
    """Load all configured repositories."""
    result = agent.load_repositories(request)
    return jsonify(result), 200


@app.route("/repository/configuration", methods=["POST"])
@handle_errors
def update_repositories():
    """Update repository configurations."""
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


# ============================================================================
# Repository Content Access
# ============================================================================


@app.route("/repository/contentList", methods=["GET"])
@handle_errors
def get_content_list():
    """Retrieve repository content list from GitHub."""
    encoded_url = request.args.get("url")
    repository_id = request.args.get("repository_id")

    if not encoded_url:
        return create_error_response("URL parameter is required", 400)

    headers = _get_repository_headers(repository_id)
    decoded_url = urllib.parse.unquote(encoded_url)
    content_url = github_web_url_to_content_api(decoded_url)

    logger.info(f"Fetching content list from: {content_url}")

    response = requests.get(content_url, headers=headers, timeout=30)
    response.raise_for_status()

    return make_response(response.content, 200, {"Content-Type": "application/json"})


@app.route("/repository/content", methods=["GET"])
@handle_errors
def get_content():
    """Download content from GitHub repository."""
    encoded_url = request.args.get("url")
    cep_block_name = request.args.get("cep_block_name")
    repository_id = request.args.get("repository_id")
    extract_fqn = parse_boolean(request.args.get("extract_fqn_cep_block", False))

    if not encoded_url:
        return create_error_response("URL parameter is required", 400)

    headers = _get_repository_headers(repository_id)
    decoded_url = urllib.parse.unquote(encoded_url)

    response = requests.get(decoded_url, headers=headers, timeout=30)
    response.raise_for_status()

    if extract_fqn:
        if not cep_block_name:
            return create_error_response(
                "cep_block_name required for FQN extraction", 400
            )
        fqn = _extract_fqn(response.text, cep_block_name)
        return make_response(fqn, 200, {"Content-Type": "text/plain"})

    return make_response(response.content, 200, {"Content-Type": "text/plain"})


# ============================================================================
# Extension Management
# ============================================================================


@app.route("/extension/repository", methods=["POST"])
@handle_errors
def create_extension_from_repository():
    """Create extension from entire repository."""
    data = request.get_json()
    extension_name = data.get("extension_name")
    repository = data.get("repository")
    upload = data.get("upload", False)
    deploy = data.get("deploy", False)
    rebuild = data.get("rebuild", False)

    if not extension_name:
        return create_error_response("Parameter extension_name is required", 400)
    if not repository or not repository.get("id"):
        return create_error_response("Parameter repository with id is required", 400)

    repo_config = agent.load_repository(request, repository["id"], replace_access_token=False)
    if not repo_config:
        return create_error_response("Repository not found", 404)

    # Handle rebuild - delete existing extension(s) before building
    if rebuild:
        try:
            deleted_count = agent.delete_extension(
                request, extension_name=extension_name
            )
            logger.info(f"Deleted {deleted_count} existing extension(s) for rebuild")
        except C8YAgentError as e:
            logger.warning(f"Failed to delete existing extensions during rebuild: {e}")
            # Continue with build even if delete fails

    return _build_and_process_extension(
        extension_name=extension_name,
        repository=repo_config,
        upload=upload,
        deploy=deploy,
        build_type="repository",
        source_fetcher=lambda work_dir, headers: _download_full_repository(
            repo_config["url"], headers, work_dir
        ),
    )


@app.route("/extension/list", methods=["POST"])
@handle_errors
def create_extension_from_list():
    """Create extension from list of files."""
    data = request.get_json()
    extension_name = data.get("extension_name")
    monitors = data.get("monitors", [])
    repository = data.get("repository")
    upload = data.get("upload", False)
    deploy = data.get("deploy", False)
    rebuild = data.get("rebuild", False)

    if not extension_name:
        return create_error_response("Parameter extension_name is required", 400)
    if len(monitors) != 1:
        return create_error_response("Exactly one monitor is required", 400)
    if not repository or not repository.get("id"):
        return create_error_response("Parameter repository with id is required", 400)

    repo_config = agent.load_repository(request, repository["id"], replace_access_token=False)
    if not repo_config:
        return create_error_response("Repository not found", 404)

    # Handle rebuild
    if rebuild:
        try:
            deleted_count = agent.delete_extension(
                request, extension_name=extension_name
            )
            logger.info(f"Deleted {deleted_count} existing extension(s) for rebuild")
        except C8YAgentError as e:
            logger.warning(f"Failed to delete existing extensions during rebuild: {e}")

    return _build_and_process_extension(
        extension_name=extension_name,
        repository=repo_config,
        upload=upload,
        deploy=deploy,
        build_type="list",
        build_info_extra={"monitors": monitors},
        source_fetcher=lambda work_dir, headers: _download_github_content(
            monitors[0]["url"], headers, work_dir
        ),
    )


@app.route("/extension/yaml", methods=["POST"])
@handle_errors
def create_extension_from_yaml():
    """Create extensions from YAML specification."""
    data = request.get_json()
    yaml_data = data.get("yaml", {})
    sections = data.get("sections", [])
    repository = data.get("repository")
    upload = data.get("upload", False)
    deploy = data.get("deploy", False)
    rebuild = data.get("rebuild", False)

    if not yaml_data or not yaml_data.get("url"):
        return create_error_response("Parameter yaml with url is required", 400)
    if not repository or not repository.get("id"):
        return create_error_response("Parameter repository with id is required", 400)

    repo_config = agent.load_repository(request, repository["id"], replace_access_token=False)
    if not repo_config:
        return create_error_response("Repository not found", 404)

    return _process_yaml_sections(
        yaml_data=yaml_data,
        sections=sections,
        repository=repo_config,
        upload=upload,
        deploy=deploy,
        rebuild=rebuild,
    )


@app.route("/extension/<extension_id>", methods=["DELETE"])
@handle_errors
def delete_extension_by_id(extension_id):
    """
    Delete a specific extension by ID.

    Path Parameters:
        extension_id: Extension ID to delete

    Example:
        DELETE /extension/12345
    """
    try:
        agent.delete_extension(request, extension_id=extension_id)
        return jsonify({"message": "Extension deleted successfully"}), 200
    except C8YAgentError as e:
        return create_error_response(str(e), 404)


@app.route("/extension", methods=["DELETE"])
@handle_errors
def delete_extensions_by_name():
    """
    Delete extension(s) by name (may delete multiple).

    Query Parameters:
        name: Extension name (required)

    Example:
        DELETE /extension?name=MyExtension
    """
    extension_name = request.args.get("name")

    if not extension_name:
        return create_error_response("Query parameter 'name' is required", 400)

    try:
        deleted_count = agent.delete_extension(
            request, extension_name=extension_name
        )

        return jsonify({
            "message": f"Successfully deleted {deleted_count} extension(s)",
            "deleted_count": deleted_count,
        }), 200

    except C8YAgentError as e:
        return create_error_response(str(e), 404)


# ============================================================================
# Private Helper Functions
# ============================================================================


def _get_repository_headers(repository_id: Optional[str] = None) -> Dict[str, str]:
    """Get headers for GitHub API requests with authentication."""
    headers = {"Accept": "application/vnd.github.v3.raw"}

    if repository_id:
        repo_config = agent.load_repository(request, repository_id, replace_access_token=False)
        if repo_config and repo_config.get("accessToken"):
            headers["Authorization"] = f"Bearer {repo_config['accessToken']}"

    return headers


def _extract_fqn(content: str, block_name: str) -> str:
    """Extract fully qualified name from monitor file."""
    package_match = re.search(r"package\s+([\w.]+)\s*;", content)
    if not package_match:
        raise ValueError("Package name not found in monitor file")

    return f"{package_match.group(1)}.{block_name}"


def _download_full_repository(url: str, headers: Dict, work_dir: str) -> None:
    """Download entire repository."""
    api_url = github_web_url_to_content_api(url)
    _download_github_content(api_url, headers, work_dir)


def _download_github_content(
    url: str,
    headers: Dict,
    work_dir: str,
    skip_root_folder: bool = True,
    item: Optional[Dict] = None,
) -> None:
    """Recursively download content from GitHub."""
    if item is None:
        response = requests.get(url, headers=headers, timeout=30)
        response.raise_for_status()

        try:
            content_response = response.json()
            if isinstance(content_response, list):
                for content_item in content_response:
                    if skip_root_folder:
                        content_item["path"] = remove_root_folders(
                            content_item["path"], 1
                        )
                    _download_github_content(
                        url, headers, work_dir, skip_root_folder, content_item
                    )
                return
        except ValueError:
            # Single file response
            file_name = extract_raw_path(url)
            full_path = os.path.join(work_dir, file_name)
            with open(full_path, "wb") as f:
                f.write(response.content)
            return

    # Process specific item
    relative_path = (
        remove_root_folders(item["path"], 1) if skip_root_folder else item["path"]
    )
    full_path = os.path.join(work_dir, relative_path)

    if item["type"] == "file":
        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        _download_file(item, headers, full_path)

    elif item["type"] == "dir":
        os.makedirs(full_path, exist_ok=True)
        response = requests.get(item["url"], headers=headers, timeout=30)
        response.raise_for_status()
        dir_contents = response.json()

        if isinstance(dir_contents, list):
            for dir_item in dir_contents:
                if skip_root_folder:
                    dir_item["path"] = remove_root_folders(dir_item["path"], 1)
                _download_github_content(
                    url, headers, work_dir, skip_root_folder, dir_item
                )


def _download_file(item: Dict, headers: Dict, full_path: str) -> None:
    """Download a single file from GitHub."""
    if item.get("download_url"):
        response = requests.get(item["download_url"], headers=headers, timeout=30)
    else:
        response = requests.get(item["url"], headers=headers, timeout=30)

    response.raise_for_status()

    try:
        content_data = response.json()
        if isinstance(content_data, dict) and "content" in content_data:
            import base64

            content = base64.b64decode(content_data["content"])
        else:
            content = response.content
    except ValueError:
        content = response.content

    with open(full_path, "wb") as f:
        f.write(content)


def _build_extension(work_dir: str, extension_name: str) -> str:
    """Build an Apama extension."""
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


def _build_and_process_extension(
    extension_name: str,
    repository: Dict,
    upload: bool,
    deploy: bool,
    build_type: str,
    source_fetcher,
    build_info_extra: Optional[Dict] = None,
):
    """Build and optionally upload an extension."""
    with tempfile.TemporaryDirectory() as work_dir:
        try:
            headers = _get_repository_headers(repository["id"])
            source_fetcher(work_dir, headers)
        except Exception as e:
            logger.error(f"Download failed: {e}", exc_info=True)
            return create_error_response(f"Failed to download content: {e}", 400)

        try:
            extension_path = _build_extension(work_dir, extension_name)
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

                build_info = {
                    "build_type": build_type,
                    "repository": repository,
                    **(build_info_extra or {}),
                }
                ext_id = agent.upload_extension(request, extension_name, ext_file, build_info)
                logger.info(f"Uploaded extension {extension_name} as {ext_id}")

                if deploy:
                    agent.restart_cep(request)

                return jsonify({"id": ext_id, "message": "Extension uploaded"}), 201

        except Exception as e:
            logger.error(f"Processing failed: {e}", exc_info=True)
            return create_error_response(f"Failed to process extension: {e}", 500)


def _process_yaml_sections(
    yaml_data: Dict,
    sections: List[str],
    repository: Dict,
    upload: bool,
    deploy: bool,
    rebuild: bool = False,
):
    """Process and build extensions from YAML specification."""
    headers = _get_repository_headers(repository["id"])

    # Fetch and parse YAML
    try:
        response = requests.get(yaml_data["url"], headers=headers, timeout=30)
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
        files = section_data.get("files", [])

        if not files:
            logger.warning(f"Section '{section_name}' has no files")
            continue

        # Handle rebuild for this section
        if rebuild and upload:
            try:
                deleted_count = agent.delete_extension(
                    request, extension_name=section_name
                )
                logger.info(
                    f"Deleted {deleted_count} existing extension(s) "
                    f"for section '{section_name}' rebuild"
                )
            except C8YAgentError as e:
                logger.warning(
                    f"Failed to delete existing extensions for section "
                    f"'{section_name}' during rebuild: {e}"
                )

        def fetch_section_files(work_dir, headers):
            base_url = repository["url"]
            for file_path in files:
                file_url = f"{base_url}/{file_path}"
                api_url = github_web_url_to_content_api(file_url)
                _download_github_content(
                    api_url, headers, work_dir, skip_root_folder=False
                )

        result = _build_and_process_extension(
            extension_name=section_name,
            repository=repository,
            upload=upload,
            deploy=deploy and (idx == len(sections_to_process) - 1),
            build_type="yaml",
            build_info_extra={
                "yaml": yaml_data,
                "sections": sections,
                "section_name": section_name,
                "files": files,
            },
            source_fetcher=fetch_section_files,
        )

        if upload:
            # Extract ID from result
            if isinstance(result, tuple):
                response_data = result[0].get_json()
                ext_id = response_data.get("id")
                uploaded_extensions.append({"name": section_name, "id": ext_id})
        elif idx == 0:
            return result

    if upload:
        return jsonify({"uploaded_extensions": uploaded_extensions}), 201

    return create_error_response("No valid sections found", 400)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=80, debug=False)