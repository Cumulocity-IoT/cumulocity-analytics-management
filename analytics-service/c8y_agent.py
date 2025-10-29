"""
Cumulocity IoT Agent for managing tenants, repositories, and CEP operations.
"""

import json
import logging
from typing import Dict, List, Optional, Set, Tuple

from c8y_api.app import MultiTenantCumulocityApp
from c8y_api.model import Binary, TenantOption
from dotenv import load_dotenv


class C8YAgent:
    """Agent for interacting with Cumulocity IoT platform."""

    # Constants
    DUMMY_ACCESS_TOKEN = "_DUMMY_ACCESS_CODE_"
    PATHS = {
        "CEP_DIAGNOSTICS": "/service/cep/diagnostics/apamaCtrlStatus",
        "TENANT_OPTIONS": "/tenant/options",
        "CEP_RESTART": "/service/cep/restart",
    }
    ANALYTICS_MANAGEMENT_REPOSITORIES = "analytics-management.repository"

    def __init__(self):
        """Initialize the C8Y Agent with logging and app configuration."""
        self._logger = logging.getLogger(self.__class__.__name__)
        load_dotenv()
        self.c8y_app = MultiTenantCumulocityApp()

    def _get_tenant_instance(self, headers: Dict, cookies: Dict):
        """
        Get tenant instance with error handling.

        Args:
            headers: HTTP headers containing authentication
            cookies: HTTP cookies

        Returns:
            Tenant instance

        Raises:
            Exception: If tenant instance cannot be retrieved
        """
        try:
            return self.c8y_app.get_tenant_instance(headers=headers, cookies=cookies)
        except Exception as e:
            self._logger.error(f"Failed to get tenant instance: {e}", exc_info=True)
            raise

    @staticmethod
    def prepare_header(request) -> Tuple[Dict, Dict]:
        """
        Prepare headers and cookies from request.

        Args:
            request: Flask request object

        Returns:
            Tuple of (headers, cookies)
        """
        return request.headers, request.cookies

    def upload_extension(
        self, request, extension_name: str, ext_file
    ) -> str:
        """
        Upload an extension to Cumulocity.

        Args:
            request: Flask request object
            extension_name: Name of the extension
            ext_file: File object containing the extension

        Returns:
            Binary ID of uploaded extension

        Raises:
            Exception: If upload fails
        """
        headers, cookies = self.prepare_header(request)
        try:
            binary = Binary(
                c8y=self._get_tenant_instance(headers, cookies),
                type="application/zip",
                name=extension_name,
                file=ext_file,
                pas_extension=extension_name,
            ).create()
            self._logger.info(f"Successfully uploaded extension: {extension_name}")
            return binary.id
        except Exception as e:
            self._logger.error(f"Failed to upload extension {extension_name}: {e}", exc_info=True)
            raise

    def restart_cep(self, request) -> None:
        """
        Attempt to restart CEP, logging any errors without raising.

        Args:
            request: Flask request object
        """
        try:
            headers, cookies = self.prepare_header(request)
            self._logger.info("Attempting to restart CEP...")

            self._get_tenant_instance(headers, cookies).put(
                resource=self.PATHS["CEP_RESTART"], json={}
            )
            self._logger.info("CEP restart command sent successfully")

        except Exception as e:
            self._logger.warning(f"Non-critical error during CEP restart: {e}")
        finally:
            self._logger.info("CEP restart procedure completed")

    def get_cep_operationobject_id(self, request) -> Optional[Dict[str, str]]:
        """
        Get CEP operation object ID.

        Args:
            request: Flask request object

        Returns:
            Dictionary with 'id' key or None if not found
        """
        headers, cookies = self.prepare_header(request)
        try:
            tenant_instance = self._get_tenant_instance(headers, cookies)
            response = tenant_instance.get(resource=self.PATHS["CEP_DIAGNOSTICS"])

            app_id = response.get("microservice_application_id")
            microservice_name = response.get("microservice_name")

            if not app_id or not microservice_name:
                self._logger.warning("Missing app_id or microservice_name in response")
                return None

            query = f"applicationId eq '{app_id}' and name eq '{microservice_name}'"
            managed_objects = tenant_instance.inventory.select(query=query)

            for managed_object in managed_objects:
                return {"id": managed_object.id}

            return None

        except Exception as e:
            self._logger.error(f"Failed to get CEP operation object ID: {e}", exc_info=True)
            return None

    def get_cep_ctrl_status(self, request) -> Optional[Dict]:
        """
        Get CEP control status.

        Args:
            request: Flask request object

        Returns:
            Status dictionary or None on error
        """
        headers, cookies = self.prepare_header(request)
        try:
            return self._get_tenant_instance(headers, cookies).get(
                resource=self.PATHS["CEP_DIAGNOSTICS"]
            )
        except Exception as e:
            self._logger.error(f"Failed to get CEP control status: {e}", exc_info=True)
            return None

    def _process_repository_data(
        self,
        repo_data,
        repository_id: Optional[str] = None,
        replace_access_token: bool = True,
    ) -> Dict:
        """
        Process repository data into standard format.

        Args:
            repo_data: Repository data (TenantOption, dict, or str)
            repository_id: Optional repository ID
            replace_access_token: Whether to replace token with dummy

        Returns:
            Processed repository dictionary
        """
        default_result = {
            "id": repository_id,
            "name": "",
            "url": "",
            "accessToken": "",
            "enabled": False,
        }

        try:
            # Handle TenantOption input
            if hasattr(repo_data, "value"):
                try:
                    value_dict = json.loads(repo_data.value)
                    repository_id = repository_id or repo_data.key
                except json.JSONDecodeError:
                    return {**default_result, "name": repo_data.value}

            # Handle string input
            elif isinstance(repo_data, str):
                try:
                    value_dict = json.loads(repo_data)
                except json.JSONDecodeError:
                    return {**default_result, "name": repo_data}

            # Handle dict input
            elif isinstance(repo_data, dict):
                value_dict = json.loads(repo_data.get("value", "{}"))
            else:
                raise ValueError(f"Unsupported repo_data type: {type(repo_data)}")

            result = {
                "id": repository_id or value_dict.get("id"),
                "name": value_dict.get("name", ""),
                "url": value_dict.get("url", ""),
                "accessToken": value_dict.get("accessToken", ""),
                "enabled": value_dict.get("enabled", False),
            }

            # Replace access token if requested and present
            if result["accessToken"] and replace_access_token:
                result["accessToken"] = self.DUMMY_ACCESS_TOKEN

            return result

        except Exception as e:
            self._logger.error(f"Error processing repository data: {e}", exc_info=True)
            return {**default_result, "name": str(repo_data)[:100]}

    def load_repositories(self, request) -> List[Dict]:
        """
        Load all configured repositories.

        Args:
            request: Flask request object

        Returns:
            List of repository dictionaries
        """
        headers, cookies = self.prepare_header(request)
        try:
            tenant = self._get_tenant_instance(headers, cookies)
            tenant_options = tenant.tenant_options.get_all(
                category=self.ANALYTICS_MANAGEMENT_REPOSITORIES
            )
            return [
                self._process_repository_data(option, option.key, replace_access_token=True)
                for option in tenant_options
            ]
        except Exception as e:
            self._logger.error(f"Failed to load repositories: {e}", exc_info=True)
            return []

    def load_repository(
        self, request, repository_id: str, replace_access_token: bool = True
    ) -> Optional[Dict]:
        """
        Load a specific repository.

        Args:
            request: Flask request object
            repository_id: Repository identifier
            replace_access_token: Whether to replace token with dummy

        Returns:
            Repository dictionary or None if not found
        """
        headers, cookies = self.prepare_header(request)
        try:
            tenant = self._get_tenant_instance(headers, cookies)
            tenant_option = tenant.tenant_options.get(
                category=self.ANALYTICS_MANAGEMENT_REPOSITORIES, key=repository_id
            )
            self._logger.debug(f"Loaded repository: {repository_id}")
            return self._process_repository_data(
                tenant_option, repository_id, replace_access_token
            )
        except KeyError:
            self._logger.warning(f"Repository not found: {repository_id}")
            return None
        except Exception as e:
            self._logger.error(f"Failed to load repository {repository_id}: {e}", exc_info=True)
            return None

    def update_repositories(
        self, request, repositories: List[Dict]
    ) -> Tuple[Dict, int]:
        """
        Update multiple repositories.

        Args:
            request: Flask request object
            repositories: List of repository dictionaries

        Returns:
            Tuple of (response dict, status code)
        """
        try:
            headers, cookies = self.prepare_header(request)
            tenant = self._get_tenant_instance(headers, cookies)

            existing_repos = self.load_repositories(request)
            new_repo_ids = {repo.get("id") for repo in repositories if repo.get("id")}
            existing_repo_ids = {repo.get("id") for repo in existing_repos if repo.get("id")}
            repos_to_delete = existing_repo_ids - new_repo_ids

            # Update/create repositories
            for repository in repositories:
                self._update_single_repository(tenant, repository)

            # Delete obsolete repositories
            self._delete_repositories(tenant, repos_to_delete)

            self._logger.info(f"Successfully updated {len(repositories)} repositories")
            return {"message": "Repositories updated successfully"}, 200

        except Exception as e:
            self._logger.error("Failed to update repositories", exc_info=True)
            return {"error": str(e)}, 500

    def _update_single_repository(self, tenant, repository: Dict) -> None:
        """
        Update a single repository.

        Args:
            tenant: Tenant instance
            repository: Repository dictionary

        Raises:
            Exception: If update fails
        """
        repo_id = repository.get("id")
        if not repo_id:
            raise ValueError("Repository ID is required")

        try:
            # Try to get existing repository
            existing_data = {}
            try:
                existing_repo = tenant.tenant_options.get(
                    category=self.ANALYTICS_MANAGEMENT_REPOSITORIES,
                    key=repo_id,
                )
                existing_data = json.loads(existing_repo.value)
            except KeyError:
                self._logger.debug(f"Creating new repository: {repo_id}")

            # Handle access token
            new_access_token = repository.get("accessToken") != self.DUMMY_ACCESS_TOKEN
            if new_access_token:
                access_token = repository.get("accessToken", "")
            else:
                access_token = existing_data.get("accessToken", "")

            # Check if URL changed and reset token if needed
            if (
                existing_data
                and existing_data.get("url") != repository.get("url")
                and not new_access_token
            ):
                access_token = ""
                self._logger.info(f"URL changed for repository {repo_id}, clearing access token")

            value_dict = {
                "name": repository.get("name", ""),
                "url": repository.get("url", ""),
                "enabled": bool(repository.get("enabled", False)),
            }

            if access_token:
                value_dict["accessToken"] = access_token

            option = TenantOption(
                category=self.ANALYTICS_MANAGEMENT_REPOSITORIES,
                key=repo_id,
                value=json.dumps(value_dict),
            )
            tenant.tenant_options.create(option)
            self._logger.info(f"Updated repository: {repo_id}")

        except Exception as e:
            self._logger.error(f"Failed to update repository {repo_id}: {e}", exc_info=True)
            raise

    def _delete_repositories(self, tenant, repo_ids: Set[str]) -> None:
        """
        Delete multiple repositories.

        Args:
            tenant: Tenant instance
            repo_ids: Set of repository IDs to delete
        """
        for repo_id in repo_ids:
            try:
                tenant.tenant_options.delete_by(
                    category=self.ANALYTICS_MANAGEMENT_REPOSITORIES, key=repo_id
                )
                self._logger.info(f"Deleted repository: {repo_id}")
            except Exception as e:
                self._logger.warning(f"Failed to delete repository {repo_id}: {e}")