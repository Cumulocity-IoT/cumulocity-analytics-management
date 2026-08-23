"""
Cumulocity IoT Agent for managing tenants, repositories, and CEP operations.
"""

import json
import logging
from typing import Dict, List, Optional, Set, Tuple

from c8y_api.app import MultiTenantCumulocityApp
from c8y_api.model import Binary, TenantOption, ManagedObject
from dotenv import load_dotenv


class C8YAgentError(Exception):
    """Custom exception for C8Y Agent errors."""

    pass


class C8YAgent:
    """Agent for interacting with Cumulocity IoT platform."""

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
        self.c8y_app = MultiTenantCumulocityApp()

    def _get_tenant(self, request) -> object:
        """Get tenant instance from request."""
        try:
            return self.c8y_app.get_tenant_instance(
                headers=request.headers, cookies=request.cookies
            )
        except Exception as e:
            self._logger.error(f"Failed to get tenant instance: {e}", exc_info=True)
            raise C8YAgentError("Failed to authenticate with Cumulocity") from e

    # ============================================================================
    # Extension Management
    # ============================================================================

    def upload_extension(
        self, request, extension_name: str, ext_file, build_info: Optional[Dict] = None
    ) -> str:
        """Upload an extension to Cumulocity."""
        try:
            binary = Binary(
                c8y=self._get_tenant(request),
                type="application/zip",
                name=extension_name,
                file=ext_file,
                pas_extension=extension_name,
                build_information=build_info or {},
            ).create()

            self._logger.info(f"Uploaded extension: {extension_name}")
            return binary.id

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
        
        try:
            tenant = self._get_tenant(request)
            deleted_count = 0
            
            if extension_id:
                # Delete by ID using binaries API
                try:
                    binary = tenant.binaries.get(extension_id)
                    
                    # Verify it's an extension
                    if not hasattr(binary, 'pas_extension'):
                        raise C8YAgentError(f"Object '{extension_id}' is not a valid extension")
                    
                    # Delete using binaries API
                    tenant.binaries.delete(extension_id)
                    self._logger.info(f"Deleted extension: {extension_id} ({binary.name})")
                    deleted_count = 1
                    
                except KeyError:
                    raise C8YAgentError(f"Extension with id '{extension_id}' not found")
            
            else:
                # Delete by name - find all matching extensions
                query = f"name eq '{extension_name}' and has(pas_extension)"
                extensions = tenant.inventory.select(query=query)

                extensions_list = list(extensions)
                if not extensions_list:
                    # Return 0 so callers can distinguish "not found" from errors
                    return 0
                
                for extension in extensions_list:
                    try:
                        # Delete using binaries API instead of inventory
                        tenant.binaries.delete(extension.id)
                        self._logger.info(f"Deleted extension: {extension.id} ({extension.name})")
                        deleted_count += 1
                    except Exception as e:
                        self._logger.warning(f"Failed to delete extension {extension.id}: {e}")
            
            return deleted_count

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
        try:
            self._get_tenant(request).put(self.PATHS["CEP_RESTART"], json={})
            self._logger.info("CEP restart command sent")
        except Exception as e:
            self._logger.warning(f"CEP restart failed (non-critical): {e}")

    def get_cep_operationobject_id(self, request) -> Optional[Dict[str, str]]:
        """Get CEP operation object ID."""
        try:
            tenant = self._get_tenant(request)
            response = tenant.get(self.PATHS["CEP_DIAGNOSTICS"])

            app_id = response.get("microservice_application_id")
            microservice_name = response.get("microservice_name")

            if not app_id or not microservice_name:
                self._logger.warning("Missing app_id or microservice_name")
                return None

            query = f"applicationId eq '{app_id}' and name eq '{microservice_name}'"
            managed_objects = tenant.inventory.select(query=query)

            for mo in managed_objects:
                return {"id": mo.id}

            return None

        except Exception as e:
            self._logger.error(f"Failed to get CEP operation object ID: {e}")
            return None

    def get_cep_ctrl_status(self, request) -> Optional[Dict]:
        """Get CEP control status."""
        try:
            return self._get_tenant(request).get(self.PATHS["CEP_DIAGNOSTICS"])
        except Exception as e:
            self._logger.error(f"Failed to get CEP status: {e}")
            return None

    # ============================================================================
    # Repository Management
    # ============================================================================

    def load_repositories(self, request) -> List[Dict]:
        """Load all configured repositories."""
        try:
            tenant = self._get_tenant(request)
            options = tenant.tenant_options.get_all(category=self.CATEGORY)
            return [self._parse_repository(opt, opt.key) for opt in options]
        except Exception as e:
            self._logger.error(f"Failed to load repositories: {e}")
            return []

    def load_repository(
        self, request, repository_id: str, replace_access_token: bool = True
    ) -> Optional[Dict]:
        """Load a specific repository."""
        try:
            tenant = self._get_tenant(request)
            option = tenant.tenant_options.get(category=self.CATEGORY, key=repository_id)
            return self._parse_repository(option, repository_id, replace_access_token)
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
        try:
            tenant = self._get_tenant(request)

            existing_repos = self.load_repositories(request)
            new_ids = {r["id"] for r in repositories if r.get("id")}
            existing_ids = {r["id"] for r in existing_repos if r.get("id")}
            to_delete = existing_ids - new_ids

            # Update/create
            for repo in repositories:
                self._save_repository(tenant, repo)

            # Delete obsolete
            for repo_id in to_delete:
                self._delete_repository(tenant, repo_id)

            self._logger.info(f"Updated {len(repositories)} repositories")
            return {"message": "Repositories updated successfully"}, 200

        except Exception as e:
            self._logger.error("Failed to update repositories", exc_info=True)
            return {"error": str(e)}, 500

    # ============================================================================
    # Private Helpers
    # ============================================================================

    def _parse_repository(
        self,
        repo_data,
        repository_id: Optional[str] = None,
        replace_access_token: bool = True,
    ) -> Dict:
        """Parse repository data into standard format."""
        default = {
            "id": repository_id,
            "name": "",
            "url": "",
            "accessToken": "",
            "enabled": False,
        }

        try:
            # Extract value
            if hasattr(repo_data, "value"):
                value_str = repo_data.value
                repository_id = repository_id or repo_data.key
            elif isinstance(repo_data, dict):
                value_str = repo_data.get("value", "{}")
            elif isinstance(repo_data, str):
                value_str = repo_data
            else:
                return default

            # Parse JSON
            try:
                value_dict = json.loads(value_str)
            except json.JSONDecodeError:
                return {**default, "name": value_str[:100]}

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
            return {**default, "name": str(repo_data)[:100]}

    def _save_repository(self, tenant, repository: Dict) -> None:
        """Save a single repository."""
        repo_id = repository.get("id")
        if not repo_id:
            raise ValueError("Repository ID is required")

        # Get existing data
        existing_token = ""
        existing_url = None
        try:
            existing = tenant.tenant_options.get(category=self.CATEGORY, key=repo_id)
            existing_data = json.loads(existing.value)
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
            category=self.CATEGORY,
            key=repo_id,
            value=json.dumps(value_dict),
        )
        tenant.tenant_options.create(option)
        self._logger.info(f"Saved repository: {repo_id}")

    def _delete_repository(self, tenant, repo_id: str) -> None:
        """Delete a single repository."""
        try:
            tenant.tenant_options.delete_by(category=self.CATEGORY, key=repo_id)
            self._logger.info(f"Deleted repository: {repo_id}")
        except Exception as e:
            self._logger.warning(f"Failed to delete repository {repo_id}: {e}")