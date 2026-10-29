"""
Cumulocity IoT Agent for managing tenants, repositories, and CEP operations.
"""

import asyncio
import json
import re
import logging
from typing import Dict, List, Optional, Tuple

from dotenv import load_dotenv

from pyc8y.app import MultiTenantCumulocityApp
from pyc8y.model.binary import Binary
from pyc8y.model.tenant_option import TenantOption


class C8YAgentError(Exception):
    """Custom exception for C8Y Agent errors."""

    pass


class C8YAgent:
    """Agent for interacting with Cumulocity IoT platform.

    pyc8y (unlike the previous c8y_api) is asyncio-only, while Flask's WSGI
    routes are synchronous. Each public method therefore opens a dedicated
    event loop and a fresh MultiTenantCumulocityApp/aiohttp session for the
    duration of that one request via `_execute`, and tears both down before
    returning - sessions can't be shared across separate `asyncio.run()`
    calls (each creates and closes its own loop).
    """

    # Constants
    DUMMY_ACCESS_TOKEN = "_DUMMY_ACCESS_CODE_"
    CATEGORY = "analytics-management.repository"
    # Global PAT written by the UI ("Manage repositories"), used by every
    # repository that has no token of its own.
    SETTINGS_CATEGORY = "analytics-management.settings"
    GLOBAL_ACCESS_TOKEN_KEY = "globalAccessToken"
    # Per-repository PATs live in options whose key starts with "credentials.":
    # Cumulocity encrypts those and hides their value from regular users, so
    # only the service user can read them back. The repository option itself
    # then holds no secret, just a `hasToken` flag.
    CREDENTIALS_CATEGORY = "analytics-management.repository-credentials"
    CREDENTIALS_PREFIX = "credentials."
    PATHS = {
        "CEP_DIAGNOSTICS": "/service/cep/diagnostics/apamaCtrlStatus",
        "CEP_RESTART": "/service/cep/restart",
    }

    def __init__(self):
        """Initialize the C8Y Agent."""
        self._logger = logging.getLogger(self.__class__.__name__)
        load_dotenv()

    def _execute(self, request, work, service=False):
        """Run `work(tenant)` inside a fresh, request-scoped session of the calling user.

        The client authenticates with the caller's own credentials, so Cumulocity
        enforces the caller's roles on every call. (`get_tenant_instance` would use
        the microservice's service user and give every authenticated user of the
        tenant its privileges.)

        With ``service=True`` the work runs as the microservice's service user
        instead. Use that only for reading and writing repository access tokens,
        and only after a user-scoped call in the same operation has proven the
        caller may access the repository.

        Args:
            request: Flask request object
            work: async callable accepting the CumulocityClient
            service: use the service user instead of the caller

        Returns:
            Whatever `work` returns.
        """

        async def _runner():
            async with MultiTenantCumulocityApp() as c8y_app:
                try:
                    if service:
                        tenant = await c8y_app.get_tenant_instance(
                            headers=request.headers, cookies=request.cookies
                        )
                    else:
                        tenant = await c8y_app.get_user_instance(
                            headers=request.headers, cookies=request.cookies
                        )
                except Exception as e:
                    self._logger.error(
                        f"Failed to get user instance: {e}", exc_info=True
                    )
                    raise C8YAgentError("Failed to authenticate with Cumulocity") from e
                return await work(tenant)

        return asyncio.run(_runner())

    # ============================================================================
    # Extension Management
    # ============================================================================

    def upload_extension(
        self, request, extension_name: str, ext_file, build_info: Optional[Dict] = None
    ) -> str:
        """Upload an extension to Cumulocity."""

        async def _work(tenant):
            binary = await Binary(
                c8y=tenant,
                content_type="application/zip",
                name=extension_name,
                file=ext_file,
                pas_extension=extension_name,
                build_information=build_info or {},
            ).create()
            return binary.id

        try:
            binary_id = self._execute(request, _work)
            self._logger.info(f"Uploaded extension: {extension_name}")
            return binary_id

        except Exception as e:
            self._logger.error(
                f"Failed to upload extension {extension_name}: {e}", exc_info=True
            )
            raise C8YAgentError(f"Failed to upload extension: {e}") from e

    def delete_extension(
        self, request, extension_id: Optional[str] = None, extension_name: Optional[str] = None
    ) -> int:
        """
        Delete extension(s) from Cumulocity inventory.

        Args:
            request: Flask request object
            extension_id: ID of the extension to delete (takes precedence)
            extension_name: Name of extension(s) to delete

        Returns:
            Number of extensions deleted

        Raises:
            C8YAgentError: If deletion fails
            ValueError: If neither id nor name provided
        """
        if not extension_id and not extension_name:
            raise ValueError("Either extension_id or extension_name must be provided")
        if not extension_id and any(c in extension_name for c in "'\\"):
            # The name is interpolated into an inventory query below
            raise ValueError("Extension name contains invalid characters")

        async def _work(tenant):
            if extension_id:
                # Delete by ID - look the object up via the general inventory
                # endpoint (Binaries exposes no single-object get), then
                # delete it through the binaries API.
                try:
                    managed_object = await tenant.inventory.get(extension_id)
                except KeyError:
                    raise C8YAgentError(f"Extension with id '{extension_id}' not found")

                if "pas_extension" not in managed_object:
                    raise C8YAgentError(f"Object '{extension_id}' is not a valid extension")

                await tenant.binaries.delete(extension_id)
                self._logger.info(
                    f"Deleted extension: {extension_id} ({managed_object.get('name')})"
                )
                return 1

            # Delete by name - find all matching extensions
            query = f"name eq '{extension_name}' and has(pas_extension)"
            extensions = [mo async for mo in tenant.inventory.select(query=query, limit=None)]

            if not extensions:
                # Return 0 so callers can distinguish "not found" from errors
                return 0

            deleted_count = 0
            for extension in extensions:
                try:
                    await tenant.binaries.delete(extension.id)
                    self._logger.info(
                        f"Deleted extension: {extension.id} ({extension.get('name')})"
                    )
                    deleted_count += 1
                except Exception as e:
                    self._logger.warning(f"Failed to delete extension {extension.id}: {e}")

            return deleted_count

        try:
            return self._execute(request, _work)
        except C8YAgentError:
            raise
        except Exception as e:
            self._logger.error(
                f"Failed to delete extension: {e}", exc_info=True
            )
            raise C8YAgentError(f"Failed to delete extension: {e}") from e

    # ============================================================================
    # CEP Operations
    # ============================================================================

    def restart_cep(self, request) -> None:
        """Restart CEP (best effort, non-critical)."""

        async def _work(tenant):
            await tenant.put(self.PATHS["CEP_RESTART"], json={})

        try:
            self._execute(request, _work)
            self._logger.info("CEP restart command sent")
        except Exception as e:
            self._logger.warning(f"CEP restart failed (non-critical): {e}")

    _GATEWAY_STATUS_RE = re.compile(r"Status: (502|503|504)\b")

    def _log_cep_error(self, message: str, error: Exception) -> None:
        """Log a CEP lookup failure; a gateway error is expected during restarts.

        While the apama-ctrl microservice restarts, the platform answers every
        diagnostics call with 502/503/504, and the UI polls continuously, so
        that is one short warning instead of an ERROR with the response body.
        """
        match = self._GATEWAY_STATUS_RE.search(str(error))
        if match:
            self._logger.warning(
                f"{message}: CEP not reachable (HTTP {match.group(1)}), "
                "expected while it restarts"
            )
        else:
            self._logger.error(f"{message}: {error}")

    def get_cep_operationobject_id(self, request) -> Optional[Dict[str, str]]:
        """Get CEP operation object ID."""

        async def _work(tenant):
            response = await tenant.get(self.PATHS["CEP_DIAGNOSTICS"])

            app_id = response.get("microservice_application_id")
            microservice_name = response.get("microservice_name")

            if not app_id or not microservice_name:
                self._logger.warning("Missing app_id or microservice_name")
                return None

            query = f"applicationId eq '{app_id}' and name eq '{microservice_name}'"
            async for managed_object in tenant.inventory.select(query=query, limit=1):
                return {"id": managed_object.id}

            return None

        try:
            return self._execute(request, _work)
        except Exception as e:
            self._log_cep_error("Failed to get CEP operation object ID", e)
            return None

    def get_cep_ctrl_status(self, request) -> Optional[Dict]:
        """Get CEP control status."""

        async def _work(tenant):
            return await tenant.get(self.PATHS["CEP_DIAGNOSTICS"])

        try:
            return self._execute(request, _work)
        except Exception as e:
            self._log_cep_error("Failed to get CEP status", e)
            return None

    # ============================================================================
    # Repository Management
    # ============================================================================

    def load_repositories(self, request) -> List[Dict]:
        """Load all configured repositories."""

        async def _work(tenant):
            return await self._load_repositories(tenant)

        try:
            return self._execute(request, _work)
        except Exception as e:
            self._logger.error(f"Failed to load repositories: {e}")
            return []

    def load_repository(
        self, request, repository_id: str, replace_access_token: bool = True
    ) -> Optional[Dict]:
        """Load a specific repository.

        The repository option is read as the caller, which proves the caller may
        see it. The real token (``replace_access_token=False``) is then read with
        the service user: own credentials option, then a legacy token still
        stored in the repository option, then the tenant-wide token.
        """

        async def _work(tenant):
            value = await tenant.tenant_options.get_value(self.CATEGORY, repository_id)
            return self._parse_repository_value(value, repository_id, replace_access_token)

        async def _secret_work(tenant):
            return (
                await self._get_secret(tenant, self._credentials_key(repository_id))
                or await self._get_global_access_token(tenant)
            )

        try:
            repo = self._execute(request, _work)
        except KeyError:
            self._logger.warning(f"Repository not found: {repository_id}")
            return None
        except Exception as e:
            self._logger.error(f"Failed to load repository {repository_id}: {e}")
            return None

        if not replace_access_token and not repo["accessToken"]:
            try:
                repo["accessToken"] = self._execute(request, _secret_work, service=True)
            except Exception as e:
                self._logger.error(f"Failed to load token of repository {repository_id}: {e}")
                return None
        return repo

    def update_repositories(
        self, request, repositories: List[Dict]
    ) -> Tuple[Dict, int]:
        """Update multiple repositories.

        The repository options are written as the caller, so Cumulocity enforces
        the caller's option permissions. Only if that succeeds are the matching
        access tokens written with the service user.
        """

        async def _work(tenant):
            existing_repos = await self._load_repositories(tenant)
            new_ids = {r["id"] for r in repositories if r.get("id")}
            existing_ids = {r["id"] for r in existing_repos if r.get("id")}
            to_delete = existing_ids - new_ids

            token_ops = []
            # Update/create
            for repo in repositories:
                token_ops.append((repo["id"], await self._save_repository(tenant, repo)))

            # Delete obsolete
            for repo_id in to_delete:
                await self._delete_repository(tenant, repo_id)
                token_ops.append((repo_id, ("delete", None)))
            return token_ops

        async def _token_work(tenant, token_ops):
            for repo_id, op in token_ops:
                if op:
                    await self._apply_token_op(tenant, repo_id, op)

        try:
            token_ops = self._execute(request, _work)
            if any(op for _, op in token_ops):
                self._execute(
                    request, lambda tenant: _token_work(tenant, token_ops), service=True
                )
            self._logger.info(f"Updated {len(repositories)} repositories")
            return {"message": "Repositories updated successfully"}, 200

        except Exception as e:
            self._logger.error("Failed to update repositories", exc_info=True)
            return {"error": str(e)}, 500

    # ============================================================================
    # Private Helpers
    # ============================================================================

    def _credentials_key(self, repository_id: str) -> str:
        return f"{self.CREDENTIALS_PREFIX}{repository_id}"

    async def _get_secret(self, tenant, key: str, category: Optional[str] = None) -> str:
        """Value of a (credentials) option, or '' if it does not exist."""
        try:
            return await tenant.tenant_options.get_value(
                category or self.CREDENTIALS_CATEGORY, key
            ) or ""
        except KeyError:
            return ""

    async def _get_global_access_token(self, tenant) -> str:
        """The tenant-wide fallback PAT, or '' if none is set.

        Prefers a ``credentials.`` option; the plain key is what older UI
        versions wrote.
        """
        return (
            await self._get_secret(
                tenant,
                self._credentials_key(self.GLOBAL_ACCESS_TOKEN_KEY),
                self.SETTINGS_CATEGORY,
            )
            or await self._get_secret(
                tenant, self.GLOBAL_ACCESS_TOKEN_KEY, self.SETTINGS_CATEGORY
            )
        )

    async def _apply_token_op(self, tenant, repo_id: str, op: Tuple[str, Optional[str]]) -> None:
        """Store or remove a repository's token as a credentials option."""
        action, token = op
        key = self._credentials_key(repo_id)
        if action == "set":
            await TenantOption(
                c8y=tenant, category=self.CREDENTIALS_CATEGORY, key=key, value=token
            ).create()
            self._logger.info(f"Saved token of repository: {repo_id}")
        else:
            try:
                await tenant.tenant_options.delete(category=self.CREDENTIALS_CATEGORY, key=key)
            except Exception as e:
                # Usually "does not exist"; a leftover token is unreachable
                # without its repository option.
                self._logger.debug(f"No token removed for repository {repo_id}: {e}")

    async def _load_repositories(self, tenant) -> List[Dict]:
        """Load all repositories for the configured category as parsed dicts."""
        try:
            values = await tenant.tenant_options.get_values(self.CATEGORY)
        except KeyError:
            return []
        return [self._parse_repository_value(v, k) for k, v in values.items()]

    def _parse_repository_value(
        self,
        value_str,
        repository_id: Optional[str] = None,
        replace_access_token: bool = True,
    ) -> Dict:
        """Parse a repository's stored tenant-option value into standard format."""
        default = {
            "id": repository_id,
            "name": "",
            "url": "",
            "accessToken": "",
            "enabled": False,
        }

        try:
            try:
                value_dict = json.loads(value_str)
            except (json.JSONDecodeError, TypeError):
                return {**default, "name": str(value_str)[:100]}

            # `accessToken` is only present in options written by older versions;
            # current ones keep the token in a credentials option (`hasToken`).
            legacy_token = value_dict.get("accessToken", "")
            has_token = bool(legacy_token) or value_dict.get("hasToken") is True

            result = {
                "id": repository_id or value_dict.get("id"),
                "name": value_dict.get("name", ""),
                "url": value_dict.get("url", ""),
                "accessToken": legacy_token,
                "enabled": value_dict.get("enabled", False),
            }

            # Replace token if needed
            if replace_access_token:
                result["accessToken"] = self.DUMMY_ACCESS_TOKEN if has_token else ""

            return result

        except Exception as e:
            self._logger.error(f"Error parsing repository: {e}")
            return {**default, "name": str(value_str)[:100]}

    async def _save_repository(
        self, tenant, repository: Dict
    ) -> Optional[Tuple[str, Optional[str]]]:
        """Save a single repository's option (without any secret).

        Returns:
            The token operation for the caller to apply with the service user:
            ``("set", token)``, ``("delete", None)`` or None for no change.
        """
        repo_id = repository.get("id")
        if not repo_id:
            raise ValueError("Repository ID is required")

        # Get existing data
        existing_token = ""
        existing_has_token = False
        existing_url = None
        try:
            existing_value = await tenant.tenant_options.get_value(self.CATEGORY, repo_id)
            existing_data = json.loads(existing_value)
            # Only options from older versions carry the token itself
            existing_token = existing_data.get("accessToken", "")
            existing_has_token = bool(existing_token) or existing_data.get("hasToken") is True
            existing_url = existing_data.get("url")
        except KeyError:
            self._logger.debug(f"Creating new repository: {repo_id}")

        # Determine the token operation. A field that's entirely absent (as
        # opposed to explicitly sent as "" or the DUMMY sentinel) means the
        # caller didn't touch it at all — preserve whatever is currently stored
        # rather than treating "not provided" the same as "clear it".
        raw_token = repository.get("accessToken")
        new_token = raw_token is not None and raw_token != self.DUMMY_ACCESS_TOKEN

        token_op: Optional[Tuple[str, Optional[str]]] = None
        if new_token:
            if raw_token:
                token_op = ("set", raw_token)
            elif existing_has_token:
                token_op = ("delete", None)
        elif existing_has_token:
            if existing_url and existing_url != repository.get("url"):
                # Reset token if URL changed
                token_op = ("delete", None)
                self._logger.info(f"URL changed for {repo_id}, clearing token")
            elif existing_token:
                # Move a token from an older version's option into a credentials option
                token_op = ("set", existing_token)
        has_token = token_op[0] == "set" if token_op else existing_has_token

        # Build value
        value_dict = {
            "name": repository.get("name", ""),
            "url": repository.get("url", ""),
            "enabled": bool(repository.get("enabled", False)),
        }

        if has_token:
            value_dict["hasToken"] = True

        # Save
        option = TenantOption(
            c8y=tenant,
            category=self.CATEGORY,
            key=repo_id,
            value=json.dumps(value_dict),
        )
        await option.create()
        self._logger.info(f"Saved repository: {repo_id}")
        return token_op

    async def _delete_repository(self, tenant, repo_id: str) -> None:
        """Delete a single repository's option."""
        try:
            await tenant.tenant_options.delete(category=self.CATEGORY, key=repo_id)
            self._logger.info(f"Deleted repository: {repo_id}")
        except Exception as e:
            self._logger.warning(f"Failed to delete repository {repo_id}: {e}")
