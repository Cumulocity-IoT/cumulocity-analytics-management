"""
Cumulocity IoT Agent for managing tenants, repositories, and CEP operations.
"""

import asyncio
import json
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
    PATHS = {
        "CEP_DIAGNOSTICS": "/service/cep/diagnostics/apamaCtrlStatus",
        "CEP_RESTART": "/service/cep/restart",
    }

    def __init__(self):
        """Initialize the C8Y Agent."""
        self._logger = logging.getLogger(self.__class__.__name__)
        load_dotenv()

    def _execute(self, request, work):
        """Run `work(tenant)` inside a fresh, request-scoped tenant session.

        Args:
            request: Flask request object
            work: async callable accepting the tenant-scoped CumulocityClient

        Returns:
            Whatever `work` returns.
        """

        async def _runner():
            async with MultiTenantCumulocityApp() as c8y_app:
                try:
                    tenant = await c8y_app.get_tenant_instance(
                        headers=request.headers, cookies=request.cookies
                    )
                except Exception as e:
                    self._logger.error(
                        f"Failed to get tenant instance: {e}", exc_info=True
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
            self._logger.error(f"Failed to get CEP operation object ID: {e}")
            return None

    def get_cep_ctrl_status(self, request) -> Optional[Dict]:
        """Get CEP control status."""

        async def _work(tenant):
            return await tenant.get(self.PATHS["CEP_DIAGNOSTICS"])

        try:
            return self._execute(request, _work)
        except Exception as e:
            self._logger.error(f"Failed to get CEP status: {e}")
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
        """Load a specific repository."""

        async def _work(tenant):
            value = await tenant.tenant_options.get_value(self.CATEGORY, repository_id)
            return self._parse_repository_value(value, repository_id, replace_access_token)

        try:
            return self._execute(request, _work)
        except KeyError:
            self._logger.warning(f"Repository not found: {repository_id}")
            return None
        except Exception as e:
            self._logger.error(f"Failed to load repository {repository_id}: {e}")
            return None

    def update_repositories(
        self, request, repositories: List[Dict]
    ) -> Tuple[Dict, int]:
        """Update multiple repositories."""

        async def _work(tenant):
            existing_repos = await self._load_repositories(tenant)
            new_ids = {r["id"] for r in repositories if r.get("id")}
            existing_ids = {r["id"] for r in existing_repos if r.get("id")}
            to_delete = existing_ids - new_ids

            # Update/create
            for repo in repositories:
                await self._save_repository(tenant, repo)

            # Delete obsolete
            for repo_id in to_delete:
                await self._delete_repository(tenant, repo_id)

        try:
            self._execute(request, _work)
            self._logger.info(f"Updated {len(repositories)} repositories")
            return {"message": "Repositories updated successfully"}, 200

        except Exception as e:
            self._logger.error("Failed to update repositories", exc_info=True)
            return {"error": str(e)}, 500

    # ============================================================================
    # Private Helpers
    # ============================================================================

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

            result = {
                "id": repository_id or value_dict.get("id"),
                "name": value_dict.get("name", ""),
                "url": value_dict.get("url", ""),
                "accessToken": value_dict.get("accessToken", ""),
                "enabled": value_dict.get("enabled", False),
            }

            # Replace token if needed
            if result["accessToken"] and replace_access_token:
                result["accessToken"] = self.DUMMY_ACCESS_TOKEN

            return result

        except Exception as e:
            self._logger.error(f"Error parsing repository: {e}")
            return {**default, "name": str(value_str)[:100]}

    async def _save_repository(self, tenant, repository: Dict) -> None:
        """Save a single repository."""
        repo_id = repository.get("id")
        if not repo_id:
            raise ValueError("Repository ID is required")

        # Get existing data
        existing_token = ""
        existing_url = None
        try:
            existing_value = await tenant.tenant_options.get_value(self.CATEGORY, repo_id)
            existing_data = json.loads(existing_value)
            existing_token = existing_data.get("accessToken", "")
            existing_url = existing_data.get("url")
        except KeyError:
            self._logger.debug(f"Creating new repository: {repo_id}")

        # Determine access token. A field that's entirely absent (as opposed
        # to explicitly sent as "" or the DUMMY sentinel) means the caller
        # didn't touch it at all — preserve whatever is currently stored
        # rather than treating "not provided" the same as "clear it".
        raw_token = repository.get("accessToken")
        if raw_token is None:
            access_token = existing_token
        elif raw_token == self.DUMMY_ACCESS_TOKEN:
            access_token = existing_token
        else:
            access_token = raw_token
        new_token = raw_token is not None and raw_token != self.DUMMY_ACCESS_TOKEN

        # Reset token if URL changed
        if existing_url and existing_url != repository.get("url") and not new_token:
            access_token = ""
            self._logger.info(f"URL changed for {repo_id}, clearing token")

        # Build value
        value_dict = {
            "name": repository.get("name", ""),
            "url": repository.get("url", ""),
            "enabled": bool(repository.get("enabled", False)),
        }

        if access_token:
            value_dict["accessToken"] = access_token

        # Save
        option = TenantOption(
            c8y=tenant,
            category=self.CATEGORY,
            key=repo_id,
            value=json.dumps(value_dict),
        )
        await option.create()
        self._logger.info(f"Saved repository: {repo_id}")

    async def _delete_repository(self, tenant, repo_id: str) -> None:
        """Delete a single repository."""
        try:
            await tenant.tenant_options.delete(category=self.CATEGORY, key=repo_id)
            self._logger.info(f"Deleted repository: {repo_id}")
        except Exception as e:
            self._logger.warning(f"Failed to delete repository {repo_id}: {e}")
