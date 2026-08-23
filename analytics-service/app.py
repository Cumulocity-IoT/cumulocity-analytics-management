"""
Flask API for managing Cumulocity extensions and repositories.

This API provides endpoints for:
- Managing GitHub repositories for Apama Analytics Builder extensions
- Building and deploying extensions from repository sources
- Managing CEP (Complex Event Processing) engine status
- CRUD operations on extensions

Architecture:
- Flask app handles HTTP requests
- C8YAgent handles Cumulocity platform interactions
- Extension building uses Apama Analytics Builder SDK
"""

import base64
import datetime
import io
import logging
import os
import pathlib
import re
import subprocess
import tempfile
import urllib.parse
from typing import Dict, List, Optional

import requests
import yaml
from flask import Flask, jsonify, make_response, request, send_file

from c8y_agent import C8YAgent, C8YAgentError
from logging_config import setup_logging
from solution_utils import (
    content_api_to_github_web_url,
    create_error_response,
    github_web_url_to_content_api,
    handle_errors,
    parse_boolean,
    parse_github_web_url,
    remove_root_folders,
    extract_raw_path,
)

# Configure logging (LOG_LEVEL/LOG_FORMAT/ENV/LOG_FILE env vars — see logging_config.py)
setup_logging()
logger = logging.getLogger(__name__)

app = Flask(__name__)
agent = C8YAgent()


# ============================================================================
# Health & Status Endpoints
# ============================================================================


@app.route("/health")
def health():
    """
    Health check endpoint.
    
    Returns:
        200: Service is healthy
        
    Response Body:
        {
            "status": "UP"
        }
    
    Example:
        GET /health
    """
    return jsonify({"status": "UP"}), 200


@app.route("/cep/id", methods=["GET"])
@handle_errors
def get_cep_operationobject_id():
    """
    Get the Cumulocity managed object ID of the CEP (Apama) microservice.
    
    This ID is used to monitor the CEP engine status and subscribe to updates.
    
    Returns:
        200: Success with operation object ID
        404: CEP operation object not found
        
    Response Body:
        {
            "id": "12345678"
        }
    
    Example:
        GET /cep/id
    """
    result = agent.get_cep_operationobject_id(request)
    if result is None:
        return create_error_response("CEP operation object not found", 404)
    return jsonify(result), 200


@app.route("/cep/status", methods=["GET"])
@handle_errors
def get_cep_ctrl_status():
    """
    Get the current status of the CEP (Apama) engine.
    
    Returns detailed information about the CEP engine including:
    - Engine status (Up/Down)
    - Safe mode status
    - Microservice application ID
    - Version information
    
    Returns:
        200: Success with status information
        404: CEP control status not available
        
    Response Body:
        {
            "status": "Up",
            "is_safe_mode": false,
            "microservice_application_id": "123",
            "microservice_name": "apama-ctrl-starter",
            ...
        }
    
    Example:
        GET /cep/status
    """
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
    """
    Load all configured GitHub repositories.
    
    Returns a list of all repositories configured for this tenant.
    Access tokens are replaced with dummy values for security.
    
    Returns:
        200: Success with list of repositories
        
    Response Body:
        [
            {
                "id": "repo-1",
                "name": "My Repository",
                "url": "https://github.com/user/repo/tree/main/path",
                "accessToken": "_DUMMY_ACCESS_CODE_",
                "enabled": true
            },
            ...
        ]
    
    Example:
        GET /repository/configuration
    """
    result = agent.load_repositories(request)
    return jsonify(result), 200


@app.route("/repository/configuration", methods=["POST"])
@handle_errors
def update_repositories():
    """
    Update repository configurations.
    
    Creates, updates, or deletes repositories. Repositories not in the request
    body will be deleted.
    
    Request Body:
        [
            {
                "id": "repo-1",
                "name": "My Repository",
                "url": "https://github.com/user/repo/tree/main/path",
                "accessToken": "ghp_xxxxx",  // Optional, use _DUMMY_ACCESS_CODE_ to keep existing
                "enabled": true
            },
            ...
        ]
    
    Returns:
        200: Repositories updated successfully
        400: Invalid request body
        
    Response Body:
        {
            "message": "Repositories updated successfully"
        }
    
    Example:
        POST /repository/configuration
        Content-Type: application/json
        
        [{"id": "repo-1", "name": "Test", "url": "https://...", "enabled": true}]
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


# ============================================================================
# Repository Content Access
# ============================================================================


@app.route("/repository/contentList", methods=["GET"])
@handle_errors
def get_content_list():
    """
    Retrieve the content list from a GitHub repository path.
    
    Converts a GitHub web URL to the API format and fetches the directory/file listing.
    
    Query Parameters:
        url (required): URL-encoded GitHub path
        repository_id (optional): Repository ID for authentication
    
    Returns:
        200: Success with content list
        400: Missing URL parameter
        
    Response:
        JSON array of files and directories from GitHub API
    
    Example:
        GET /repository/contentList?url=https%3A%2F%2Fgithub.com%2Fuser%2Frepo%2Ftree%2Fmain%2Fblocks&repository_id=repo-1
    """
    encoded_url = request.args.get("url")
    repository_id = request.args.get("repository_id")
    access_token = request.headers.get("X-Repository-Access-Token")

    if not encoded_url:
        return create_error_response("URL parameter is required", 400)

    headers = _get_repository_headers(repository_id, access_token)
    decoded_url = urllib.parse.unquote(encoded_url)
    content_url = github_web_url_to_content_api(decoded_url)

    logger.info(f"Fetching content list from: {content_url}")

    response = requests.get(content_url, headers=headers, timeout=30)
    error = _github_error_response(response)
    if error:
        return error

    return make_response(response.content, 200, {"Content-Type": "application/json"})


@app.route("/repository/content", methods=["GET"])
@handle_errors
def get_content():
    """
    Download file content from a GitHub repository.
    
    Can optionally extract the Fully Qualified Name (FQN) from an Apama monitor file.
    
    Query Parameters:
        url (required): URL-encoded GitHub file URL
        repository_id (optional): Repository ID for authentication
        extract_fqn_cep_block (optional): Set to "true" to extract FQN
        cep_block_name (required if extract_fqn_cep_block=true): Block name for FQN extraction
    
    Returns:
        200: Success with file content or FQN
        400: Missing required parameters
        
    Response:
        - If extract_fqn_cep_block=false: Raw file content
        - If extract_fqn_cep_block=true: FQN string (e.g., "com.example.blocks.MyBlock")
    
    Example:
        GET /repository/content?url=https%3A%2F%2Fraw.githubusercontent.com%2F...%2FMyBlock.mon&extract_fqn_cep_block=true&cep_block_name=MyBlock&repository_id=repo-1
    """
    encoded_url = request.args.get("url")
    cep_block_name = request.args.get("cep_block_name")
    repository_id = request.args.get("repository_id")
    access_token = request.headers.get("X-Repository-Access-Token")
    extract_fqn = parse_boolean(request.args.get("extract_fqn_cep_block", False))

    if not encoded_url:
        return create_error_response("URL parameter is required", 400)

    headers = _get_repository_headers(repository_id, access_token)
    decoded_url = urllib.parse.unquote(encoded_url)

    response = requests.get(decoded_url, headers=headers, timeout=30)
    error = _github_error_response(response)
    if error:
        return error

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
    """
    Create an Apama extension from an entire GitHub repository.
    
    Downloads all contents from the repository path, builds it into an extension,
    and optionally uploads it to Cumulocity.
    
    Request Body:
        {
            "extension_name": "MyExtension",     // Required: Name for the extension
            "repository": {                       // Required: Repository configuration
                "id": "repo-1"
            },
            "upload": false,                      // Optional: Upload to Cumulocity (default: false)
            "deploy": false,                      // Optional: Restart CEP after upload (default: false)
            "rebuild": false                      // Optional: Delete existing extension first (default: false)
        }
    
    Behavior:
        - If upload=false: Returns the .zip file for download
        - If upload=true: Uploads to Cumulocity and returns extension ID
        - If rebuild=true: Deletes existing extension(s) with same name before building
          - If no existing extension found, returns 404 error
        - If deploy=true: Restarts CEP engine after successful upload
    
    Returns:
        200: Success (download mode) - Returns .zip file
        201: Success (upload mode) - Extension uploaded
        400: Invalid request or build failed
        404: Repository not found OR rebuild requested but no existing extension found
        
    Response Body (upload mode):
        {
            "id": "12345678",
            "message": "Extension uploaded"
        }
    
    Example:
        POST /extension/repository
        Content-Type: application/json
        
        {
            "extension_name": "MyBlocks",
            "repository": {"id": "repo-1"},
            "upload": true,
            "deploy": true
        }
    """
    data = request.get_json()
    extension_name = data.get("extension_name")
    repository = data.get("repository")
    upload = data.get("upload", False)
    deploy = data.get("deploy", False)
    rebuild = data.get("rebuild", False)

    name_error = _validate_extension_name(extension_name)
    if name_error:
        return create_error_response(name_error, 400)
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
            if deleted_count == 0:
                error_msg = (
                    f"Rebuild requested but no existing extension named '{extension_name}' "
                    "was found to delete. Cannot proceed with rebuild."
                )
                logger.error(error_msg)
                return create_error_response(error_msg, 404)
            
            logger.info(f"Deleted {deleted_count} existing extension(s) for rebuild")
        except C8YAgentError as e:
            error_msg = f"Failed to delete existing extension during rebuild: {e}"
            logger.error(error_msg)
            return create_error_response(error_msg, 400)

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
    """
    Create an Apama extension from a single file or directory.
    
    Downloads a specific file (.mon) or directory from the repository and builds it
    into an extension.
    
    Request Body:
        {
            "extension_name": "MyExtension",     // Required: Name for the extension
            "monitors": [                         // Required: Array with exactly one item
                {
                    "url": "https://api.github.com/repos/.../MyBlock.mon",
                    "name": "MyBlock",
                    "type": "file"  // or "dir"
                }
            ],
            "repository": {                       // Required: Repository configuration
                "id": "repo-1"
            },
            "upload": false,                      // Optional: Upload to Cumulocity (default: false)
            "deploy": false,                      // Optional: Restart CEP after upload (default: false)
            "rebuild": false                      // Optional: Delete existing extension first (default: false)
        }
    
    Behavior:
        - monitors must contain exactly one item (file or directory)
        - If type="file": Downloads single .mon file
        - If type="dir": Downloads entire directory recursively
        - rebuild behavior same as /extension/repository
    
    Returns:
        200: Success (download mode)
        201: Success (upload mode)
        400: Invalid request (wrong number of monitors, build failed)
        404: Repository not found OR rebuild requested but no existing extension found
        
    Response Body (upload mode):
        {
            "id": "12345678",
            "message": "Extension uploaded"
        }
    
    Example:
        POST /extension/list
        Content-Type: application/json
        
        {
            "extension_name": "MyBlock",
            "monitors": [{"url": "https://...", "name": "MyBlock", "type": "file"}],
            "repository": {"id": "repo-1"},
            "upload": true
        }
    """
    data = request.get_json()
    extension_name = data.get("extension_name")
    monitors = data.get("monitors", [])
    repository = data.get("repository")
    upload = data.get("upload", False)
    deploy = data.get("deploy", False)
    rebuild = data.get("rebuild", False)

    name_error = _validate_extension_name(extension_name)
    if name_error:
        return create_error_response(name_error, 400)
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
            if deleted_count == 0:
                error_msg = (
                    f"Rebuild requested but no existing extension named '{extension_name}' "
                    "was found to delete. Cannot proceed with rebuild."
                )
                logger.error(error_msg)
                return create_error_response(error_msg, 404)
            
            logger.info(f"Deleted {deleted_count} existing extension(s) for rebuild")
        except C8YAgentError as e:
            error_msg = f"Failed to delete existing extension during rebuild: {e}"
            logger.error(error_msg)
            return create_error_response(error_msg, 400)

    monitor = monitors[0]

    if monitor.get("type") == "dir":
        # Directory selections recurse through the whole subtree, so use a single
        # Git Trees API listing instead of one Content API request per directory.
        def source_fetcher(work_dir, headers):
            web_url = content_api_to_github_web_url(monitor["url"])
            parsed = parse_github_web_url(web_url)
            _download_directory_via_tree(
                parsed["owner"], parsed["repo"], parsed["branch"], parsed["path"],
                headers, work_dir,
            )
    else:
        def source_fetcher(work_dir, headers):
            _download_github_content(monitor["url"], headers, work_dir)

    return _build_and_process_extension(
        extension_name=extension_name,
        repository=repo_config,
        upload=upload,
        deploy=deploy,
        build_type="list",
        build_info_extra={"monitors": monitors},
        source_fetcher=source_fetcher,
    )


@app.route("/extension/yaml", methods=["POST"])
@handle_errors
def create_extension_from_yaml():
    """
    Create one or more Apama extensions from a YAML specification file.
    
    This endpoint is used for complex repositories that contain multiple extensions
    defined in a YAML file (typically named 'extensions.yaml' or similar).
    
    YAML File Structure Example:
        Python:
          files:
            - plugin.yaml
            - Python.mon
            - pythonBlockPlugin.py
            - venv/
        
        Offset:
          files:
            - Offset.mon
        
        Difference:
          files:
            - Difference.mon
    
    The YAML file defines "sections" (top-level keys like "Python", "Offset", "Difference"),
    each specifying which files to include in that extension.
    
    Request Body:
        {
            "yaml": {                             // Required: YAML file reference
                "url": "https://raw.githubusercontent.com/.../extensions.yaml"
            },
            "sections": ["Python", "Offset"],     // Optional: Which sections to build
                                                  // If empty/null: builds ALL sections
            "repository": {                       // Required: Repository configuration
                "id": "repo-1"
            },
            "upload": false,                      // Optional: Upload to Cumulocity (default: false)
            "deploy": false,                      // Optional: Restart CEP after last upload (default: false)
            "rebuild": false                      // Optional: Delete existing extensions first (default: false)
        }
    
    Sections Parameter Explained:
        - If sections = []: Builds ALL sections found in YAML
        - If sections = ["Python", "Offset"]: Builds only these two sections
        - Each section becomes a separate extension with that section name
        - Files for each section are downloaded relative to repository base URL
    
    Behavior:
        - Parses YAML file to get section definitions
        - For each section (or selected sections):
          1. Downloads all files listed in section.files
          2. Builds extension named after the section
          3. Optionally uploads to Cumulocity
        - If rebuild=true: Deletes existing extension for each section before building
          - If any section's extension doesn't exist, that section fails but others continue
        - If deploy=true: Restarts CEP only after ALL sections are processed
    
    Returns:
        200: Success (download mode) - Returns first section's .zip
        201: Success (upload mode) - All sections uploaded
        207: Partial success (upload mode) - Some sections failed
        400: Invalid YAML structure or all sections failed
        404: Repository not found
        
    Response Body (upload mode - all success):
        {
            "uploaded_extensions": [
                {"name": "Python", "id": "12345"},
                {"name": "Offset", "id": "67890"}
            ]
        }
    
    Response Body (upload mode - partial success):
        {
            "uploaded_extensions": [
                {"name": "Python", "id": "12345"}
            ],
            "failed_sections": [
                {
                    "section": "Offset",
                    "error": "Rebuild requested but no existing extension named 'Offset' was found..."
                }
            ],
            "message": "Partially completed: 1 succeeded, 1 failed"
        }
    
    Example:
        POST /extension/yaml
        Content-Type: application/json
        
        {
            "yaml": {"url": "https://raw.githubusercontent.com/.../extensions.yaml"},
            "sections": ["Python"],  // Build only Python section
            "repository": {"id": "repo-1"},
            "upload": true,
            "deploy": true
        }
    
    Use Cases:
        1. Build all extensions: sections = []
        2. Build specific extensions: sections = ["Python", "Offset"]
        3. Build and deploy: upload = true, deploy = true
        4. Replace existing: rebuild = true, upload = true
    """
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
    Delete a specific extension by its Cumulocity managed object ID.
    
    Path Parameters:
        extension_id: Cumulocity managed object ID of the extension
    
    Returns:
        200: Extension deleted successfully
        404: Extension not found
        
    Response Body:
        {
            "message": "Extension deleted successfully"
        }
    
    Example:
        DELETE /extension/12345678
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
    Delete one or more extensions by name.
    
    This can delete multiple extensions if they share the same name.
    
    Query Parameters:
        name (required): Extension name to search for and delete
    
    Returns:
        200: Extension(s) deleted successfully
        400: Missing name parameter
        404: No extensions found with that name
        
    Response Body:
        {
            "message": "Successfully deleted 2 extension(s)",
            "deleted_count": 2
        }
    
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

        if deleted_count == 0:
            return create_error_response(
                f"No extensions found with name '{extension_name}'", 404
            )

        return jsonify({
            "message": f"Successfully deleted {deleted_count} extension(s)",
            "deleted_count": deleted_count,
        }), 200

    except C8YAgentError as e:
        return create_error_response(str(e), 500)


# ============================================================================
# Private Helper Functions
# ============================================================================


_VALID_EXTENSION_NAME_RE = re.compile(r"^[a-zA-Z0-9_-]+$")


def _validate_extension_name(name: str) -> Optional[str]:
    """Return an error message if the name is invalid, otherwise None."""
    if not name:
        return "Extension name must not be empty"
    if not _VALID_EXTENSION_NAME_RE.match(name):
        return "Extension name may only contain letters, digits, hyphens and underscores"
    return None


def _get_repository_headers(
    repository_id: Optional[str] = None,
    access_token: Optional[str] = None,
) -> Dict[str, str]:
    """Get headers for GitHub API requests with authentication.

    Resolution order for the PAT:
      1. ``access_token`` argument (typically sourced from the ``X-Repository-Access-Token``
         request header — used by the "Test connection" flow to validate a draft
         repository before it is saved). Header-based delivery keeps the PAT out
         of HTTP access logs and browser history.
      2. The PAT stored against ``repository_id`` (resolved via ``agent.load_repository``).
    """
    headers = {"Accept": "application/vnd.github.v3.raw"}

    if access_token:
        headers["Authorization"] = f"Bearer {access_token}"
        logger.info("Using caller-supplied PAT")
        return headers

    if repository_id:
        repo_config = agent.load_repository(request, repository_id, replace_access_token=False)
        if repo_config and repo_config.get("accessToken"):
            headers["Authorization"] = f"Bearer {repo_config['accessToken']}"
            logger.info("Repository %s: sending request WITH stored PAT", repository_id)
        else:
            logger.info(
                "Repository %s: no PAT stored, sending UNAUTHENTICATED request "
                "(GitHub limits these to 60 requests/hour per IP)",
                repository_id,
            )

    return headers


def _github_error_response(response: requests.Response):
    """Translate a failed GitHub API response into a clear Flask error response.

    Returns ``None`` when the request succeeded, so callers can use::

        err = _github_error_response(response)
        if err:
            return err

    GitHub returns ``403`` (or ``429``) with ``X-RateLimit-Remaining: 0`` once the
    request quota is exhausted. Unauthenticated requests are limited to 60/hour per
    IP; supplying a valid Personal Access Token raises this to 5000/hour. This case
    is otherwise indistinguishable from a permissions error, so spell it out.
    """
    if response.ok:
        return None

    status = response.status_code
    remaining = response.headers.get("X-RateLimit-Remaining")
    sso_header = response.headers.get("X-GitHub-SSO")

    # Log the signals that disambiguate the failure so the cause is provable
    # from the microservice logs without guesswork.
    logger.warning(
        "GitHub error %s (X-RateLimit-Remaining=%s, X-RateLimit-Limit=%s, X-GitHub-SSO=%s)",
        status,
        remaining,
        response.headers.get("X-RateLimit-Limit"),
        sso_header,
    )

    # SSO not authorized for the token against an SSO-enforced org. GitHub returns
    # 403 with an X-GitHub-SSO header rather than a rate-limit signal.
    if status == 403 and sso_header:
        message = (
            "GitHub single sign-on authorization required for this token. Open the "
            "token at github.com/settings/tokens, click 'Configure SSO' and authorize "
            f"it for the organization, then retry. (X-GitHub-SSO: {sso_header})"
        )
        return create_error_response(message, status)

    if status in (403, 429) and remaining == "0":
        reset = response.headers.get("X-RateLimit-Reset")
        when = ""
        if reset and reset.isdigit():
            reset_at = datetime.datetime.fromtimestamp(
                int(reset), datetime.timezone.utc
            ).strftime("%Y-%m-%d %H:%M UTC")
            when = f" Limit resets at {reset_at}."
        message = (
            "GitHub API rate limit exceeded. Unauthenticated requests are limited "
            "to 60/hour per IP; add a valid Personal Access Token to this repository "
            f"to raise the limit to 5000/hour.{when}"
        )
        logger.warning("GitHub rate limit exceeded (status %s)", status)
        return create_error_response(message, status)

    # Fall back to GitHub's own error message when present (it is more specific
    # than the generic HTTPError string, e.g. SSO authorization required).
    github_message = None
    try:
        github_message = response.json().get("message")
    except ValueError:
        pass

    return create_error_response(
        github_message or response.text or f"GitHub request failed ({status})",
        status,
    )


def _extract_fqn(content: str, block_name: str) -> str:
    """Extract fully qualified name from monitor file."""
    package_match = re.search(r"package\s+([\w.]+)\s*;", content)
    if not package_match:
        raise ValueError("Package name not found in monitor file")

    return f"{package_match.group(1)}.{block_name}"


def _download_directory_via_tree(
    owner: str,
    repo: str,
    branch: str,
    path_prefix: str,
    headers: Dict,
    work_dir: str,
) -> None:
    """
    Download every file under ``path_prefix`` using the GitHub Git Trees API.

    A single ``git/trees/{branch}?recursive=1`` call lists the entire directory
    subtree, replacing the Content API's one-request-per-directory recursion
    (``_download_github_content``). Matched files are then fetched directly from
    raw.githubusercontent.com, which is not subject to the same 5000-requests/hour
    core API quota as api.github.com, further reducing rate-limit consumption.
    """
    tree_url = f"https://api.github.com/repos/{owner}/{repo}/git/trees/{branch}?recursive=1"
    response = requests.get(tree_url, headers=headers, timeout=30)
    response.raise_for_status()
    tree_data = response.json()

    if tree_data.get("truncated"):
        logger.warning(
            "Git tree for %s/%s@%s was truncated by GitHub (repository too large "
            "for a single recursive listing); some files under '%s' may be missing",
            owner, repo, branch, path_prefix or "/",
        )

    prefix = f"{path_prefix}/" if path_prefix else ""
    raw_headers = {k: v for k, v in headers.items() if k.lower() == "authorization"}

    downloaded_any = False
    for entry in tree_data.get("tree", []):
        if entry.get("type") != "blob":
            continue

        entry_path = entry["path"]
        if path_prefix and not (entry_path == path_prefix or entry_path.startswith(prefix)):
            continue

        relative_path = entry_path[len(prefix):] if prefix else entry_path
        if not relative_path:
            continue

        full_path = _safe_join(work_dir, relative_path)
        os.makedirs(os.path.dirname(full_path), exist_ok=True)

        raw_url = (
            f"https://raw.githubusercontent.com/{owner}/{repo}/{branch}/"
            f"{urllib.parse.quote(entry_path)}"
        )
        file_response = requests.get(raw_url, headers=raw_headers, timeout=30)
        file_response.raise_for_status()

        with open(full_path, "wb") as f:
            f.write(file_response.content)

        downloaded_any = True

    if not downloaded_any:
        raise ValueError(
            f"No files found under '{path_prefix or '/'}' in {owner}/{repo}@{branch}"
        )


def _download_full_repository(url: str, headers: Dict, work_dir: str) -> None:
    """Download entire repository path via the Git Trees API (single listing request)."""
    parsed = parse_github_web_url(url)
    _download_directory_via_tree(
        parsed["owner"], parsed["repo"], parsed["branch"], parsed["path"], headers, work_dir
    )


def _safe_join(work_dir: str, relative_path: str) -> str:
    """
    Resolve the destination path and verify it stays within work_dir.

    Raises ValueError if the resolved path would escape the work directory
    (e.g. via ``../`` sequences or absolute paths supplied by the remote).
    """
    base = pathlib.Path(work_dir).resolve()
    candidate = (base / relative_path).resolve()
    if not str(candidate).startswith(str(base) + os.sep) and candidate != base:
        raise ValueError(
            f"Path traversal attempt detected: '{relative_path}' resolves outside work directory"
        )
    return str(candidate)


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
            full_path = _safe_join(work_dir, file_name)
            with open(full_path, "wb") as f:
                f.write(response.content)
            return

    # Process specific item
    relative_path = (
        remove_root_folders(item["path"], 1) if skip_root_folder else item["path"]
    )
    full_path = _safe_join(work_dir, relative_path)

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
            # `repository` here is already the loaded repo_config (with its
            # real accessToken) from the caller — reuse it instead of making
            # another agent.load_repository() round-trip for the same id.
            headers = _get_repository_headers(access_token=repository.get("accessToken"))
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
    # `repository` is already the loaded repo_config (with its real
    # accessToken) from the caller — reuse it instead of another
    # agent.load_repository() round-trip for the same id.
    headers = _get_repository_headers(access_token=repository.get("accessToken"))

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
    failed_sections = []

    for idx, section_name in enumerate(sections_to_process):
        name_error = _validate_extension_name(section_name)
        if name_error:
            logger.warning(f"Skipping section '{section_name}': {name_error}")
            failed_sections.append({"section": section_name, "error": name_error})
            continue

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
                if deleted_count == 0:
                    error_msg = (
                        f"Rebuild requested but no existing extension named '{section_name}' "
                        "was found to delete. Cannot proceed with rebuild for this section."
                    )
                    logger.error(error_msg)
                    failed_sections.append({
                        "section": section_name,
                        "error": error_msg
                    })
                    continue
                
                logger.info(
                    f"Deleted {deleted_count} existing extension(s) "
                    f"for section '{section_name}' rebuild"
                )
            except C8YAgentError as e:
                error_msg = (
                    f"Failed to delete existing extension for section "
                    f"'{section_name}' during rebuild: {e}"
                )
                logger.error(error_msg)
                failed_sections.append({
                    "section": section_name,
                    "error": str(e)
                })
                continue

        def fetch_section_files(work_dir, headers):
            base_url = repository["url"]
            for file_path in files:
                file_url = f"{base_url}/{file_path}"
                api_url = github_web_url_to_content_api(file_url)
                _download_github_content(
                    api_url, headers, work_dir, skip_root_folder=False
                )

        try:
            # Deploy (CEP restart) is handled once, after the loop, only if
            # at least one section actually succeeded — not gated on this
            # being the last positional index, which can be a section that
            # never reaches this call (e.g. failed name validation above).
            result = _build_and_process_extension(
                extension_name=section_name,
                repository=repository,
                upload=upload,
                deploy=False,
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
                # Extract ID from result; a plain (non-tuple) Response here
                # means _build_and_process_extension returned an error
                # response (create_error_response), so record it as a
                # failure instead of dropping it silently.
                if isinstance(result, tuple):
                    response_data = result[0].get_json()
                    ext_id = response_data.get("id")
                    uploaded_extensions.append({"name": section_name, "id": ext_id})
                else:
                    error_data = result.get_json() or {}
                    error_msg = error_data.get(
                        "error", f"Failed to build section '{section_name}'"
                    )
                    logger.error(f"Section '{section_name}' failed: {error_msg}")
                    failed_sections.append({
                        "section": section_name,
                        "error": error_msg
                    })
            elif idx == 0:
                return result
        except Exception as e:
            error_msg = f"Failed to build section '{section_name}': {e}"
            logger.error(error_msg)
            failed_sections.append({
                "section": section_name,
                "error": str(e)
            })

    if upload:
        if deploy and uploaded_extensions:
            agent.restart_cep(request)

        if failed_sections:
            return jsonify({
                "uploaded_extensions": uploaded_extensions,
                "failed_sections": failed_sections,
                "message": f"Partially completed: {len(uploaded_extensions)} succeeded, {len(failed_sections)} failed"
            }), 207  # Multi-Status

        if uploaded_extensions:
            return jsonify({"uploaded_extensions": uploaded_extensions}), 201

        return create_error_response(
            "All sections failed to build. See details in failed_sections.",
            400
        )

    return create_error_response("No valid sections found", 400)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=80, debug=False)