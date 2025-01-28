import logging
from xmlrpc.client import boolean
from dotenv import load_dotenv
from c8y_api.app import MultiTenantCumulocityApp
from c8y_api.model import Binary, TenantOption
import json
from typing import Dict, List, Optional, Set, Tuple, Union

# These two lines enable debugging at httplib level (requests->urllib3->http.client)
# You will see the REQUEST, including HEADERS and DATA, and RESPONSE with HEADERS but without DATA.
# The only thing missing will be the response.body which is not logged.
# import http.client as http_client

# http_client.HTTPConnection.debuglevel = 1
# # You must initialize logging, otherwise you'll not see debug output.
# logging.basicConfig()
# logging.getLogger().setLevel(logging.DEBUG)
# requests_log = logging.getLogger("requests.packages.urllib3")
# requests_log.setLevel(logging.DEBUG)
# requests_log.propagate = True

import logging
from dotenv import load_dotenv
from c8y_api.app import MultiTenantCumulocityApp
from c8y_api.model import Binary, TenantOption
import json
from typing import Dict, List, Optional, Set, Tuple


class C8YAgent:
    # Constants
    DUMMY_ACCESS_TOKEN = "_DUMMY_ACCESS_CODE_"
    PATHS = {
        "CEP_DIAGNOSTICS": "/service/cep/diagnostics/apamaCtrlStatus",
        "TENANT_OPTIONS": "/tenant/options",
        "CEP_RESTART": "/service/cep/restart",
    }
    ANALYTICS_MANAGEMENT_REPOSITORIES = "analytics-management.repository"

    def __init__(self):
        self._logger = logging.getLogger("C8YAgent")
        self._logger.setLevel(logging.DEBUG)
        load_dotenv()
        self.c8y_app = MultiTenantCumulocityApp()

    def _get_tenant_instance(self, headers: Dict, cookies: Dict) -> any:
        """Get tenant instance with error handling"""
        return self.c8y_app.get_tenant_instance(headers=headers, cookies=cookies)

    def _handle_request(self, func, *args, **kwargs) -> Tuple[Dict, int]:
        """Generic request handler with error handling"""
        try:
            result = func(*args, **kwargs)
            return {"data": result, "message": "Operation successful"}, 200
        except Exception as e:
            self._logger.error("Exception occurred:", exc_info=True)
            return {"error": str(e)}, 500

    def upload_extension(self, request, extension_name: str, ext_file) -> str:
        [headers, cookies] = self.prepare_header(request)
        binary = Binary(
            c8y=self._get_tenant_instance(headers, cookies),
            type="application/zip",
            name=extension_name,
            file=ext_file,
            pas_extension=extension_name,
        ).create()
        return binary.id

    def restart_cep(self, request) -> None:
        """
        Attempt to restart CEP, ignoring any errors that occur.

        Args:
            request: The incoming request object
        """
        try:
            [headers, cookies] = self.prepare_header(request)
            self._logger.info("Attempting to restart CEP...")

            self._get_tenant_instance(headers, cookies).put(
                resource=self.PATHS["CEP_RESTART"], json={}
            )

        except Exception as e:
            # Log the error but don't raise it
            self._logger.warning(f"Non-critical error during CEP restart: {str(e)}")
            self._logger.info("CEP restart command sent successfully")
        finally:
            self._logger.info("CEP restart procedure completed")

    def get_cep_operationobject_id(self, request) -> Optional[Dict]:
        [headers, cookies] = self.prepare_header(request)
        # response = self._get_tenant_instance(headers,cookies).get(
        #     resource=self.PATHS['CEP_DIAGNOSTICS']
        # )

        ti = self._get_tenant_instance(headers, cookies)
        self._logger.info(f"Updated get_cep_operationobject_id: {ti}")
        self._logger.info(f"Updated path: {self.PATHS['CEP_DIAGNOSTICS']}")
        response = ti.get(resource=self.PATHS["CEP_DIAGNOSTICS"])

        app_id = response.get("microservice_application_id")
        microservice_name = response.get("microservice_name")

        if not all([app_id, microservice_name]):
            return None

        query = f"applicationId eq '{app_id}' and name eq '{microservice_name}'"
        managed_objects = self._get_tenant_instance(headers, cookies).inventory.select(
            query=query
        )

        for managed_object in managed_objects:
            return {"id": managed_object.id}

        return None

    def get_cep_ctrl_status(self, request) -> Dict:
        [headers, cookies] = self.prepare_header(request)
        return self._get_tenant_instance(headers, cookies).get(
            resource=self.PATHS["CEP_DIAGNOSTICS"]
        )

    def _process_repository_data(
        self, repo_data: Union[Dict, str, "TenantOption"], repository_id: str = None, replace_access_token: boolean = True
    ) -> Dict:
        """
        Process repository data into standard format.

        Args:
            repo_data: Repository data as either a dictionary, JSON string, or TenantOption
            repository_id: Optional repository ID

        Returns:
            Dictionary containing processed repository data
        """
        try:
            # Handle TenantOption input
            if hasattr(repo_data, "value"):
                try:
                    value_dict = json.loads(repo_data.value)
                except json.JSONDecodeError:
                    return {
                        "id": repository_id or repo_data.key,
                        "name": repo_data.value,  # Use the value as name
                        "url": "",
                        "accessToken": "",
                        "enabled": False,
                    }
            # Handle string input
            elif isinstance(repo_data, str):
                try:
                    value_dict = json.loads(repo_data)
                except json.JSONDecodeError:
                    return {
                        "id": repository_id,
                        "name": repo_data,  # Use the string as name
                        "url": "",
                        "accessToken": "",
                        "enabled": False,
                    }
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
            # If there's an access token and replace_access_token, replace it with dummy
            if value_dict.get("accessToken") and replace_access_token:
                result["accessToken"] = self.DUMMY_ACCESS_TOKEN
            # Process the dictionary
            return result
        except Exception as e:
            self._logger.error(f"Error processing repository data: {e}", exc_info=True)
            # Return a basic dict with default values in case of error
            return {
                "id": repository_id,
                "name": str(repo_data)[:100],  # Truncate long strings
                "url": "",
                "accessToken": "",
                "enabled": False,
            }

    def load_repositories(self, request) -> List[Dict]:
        [headers, cookies] = self.prepare_header(request)
        tenant = self._get_tenant_instance(headers, cookies)
        tenant_options = tenant.tenant_options.get_all(
            category=self.ANALYTICS_MANAGEMENT_REPOSITORIES
        )
        return [
            self._process_repository_data(option, option.key, True)
            for option in tenant_options
        ]

    def load_repository(
        self, request, repository_id: str, replace_access_token: boolean
    ) -> Dict:
        [headers, cookies] = self.prepare_header(request)
        tenant = self._get_tenant_instance(headers, cookies)
        tenant_option = tenant.tenant_options.get(
            category=self.ANALYTICS_MANAGEMENT_REPOSITORIES, key=repository_id
        )
        # Print various attributes of the TenantOption object
        print(f"TenantOption contents:")
        print(f"Category: {tenant_option.category}")
        print(f"Key: {tenant_option.key}")
        print(f"Value: {tenant_option.value}")

        # Print the entire object
        print(f"Complete TenantOption object: {vars(tenant_option)}")
        return self._process_repository_data(
            tenant_option, repository_id, replace_access_token
        )

    def update_repositories(
        self, request, repositories: List[Dict]
    ) -> Tuple[Dict, int]:
        try:
            [headers, cookies] = self.prepare_header(request)
            tenant = self._get_tenant_instance(headers, cookies)

            existing_repos = self.load_repositories(request)
            new_repo_ids = {repo.get("id") for repo in repositories}
            existing_repo_ids = {repo.get("id") for repo in existing_repos}
            repos_to_delete = existing_repo_ids - new_repo_ids

            # Batch process repositories
            for repository in repositories:
                self._update_single_repository(tenant, repository)

            # Batch delete obsolete repositories
            self._delete_repositories(tenant, repos_to_delete)

            return {"message": "Repositories updated successfully"}, 200

        except Exception as e:
            self._logger.error("Failed to update repositories:", exc_info=True)
            return {"error": str(e)}, 500

    def _update_single_repository(self, tenant, repository: Dict) -> None:
        """Helper method to update a single repository"""
        try:
            # If the access token is the dummy, get the original from existing repository
            if repository.get("accessToken") == self.DUMMY_ACCESS_TOKEN:
                existing_repo = tenant.tenant_options.get(
                    category=self.ANALYTICS_MANAGEMENT_REPOSITORIES,
                    key=repository.get("id"),
                )
                if existing_repo:
                    existing_data = json.loads(existing_repo.value)
                    access_token = existing_data.get("accessToken", "")
                else:
                    access_token = ""
            else:
                access_token = repository.get("accessToken", "")

            value_dict = {
                "name": repository.get("name"),
                "url": repository.get("url"),
                "enabled": bool(repository.get("enabled", False)),
            }

            # Only add access token if it exists
            if access_token:
                value_dict["accessToken"] = access_token

            option = TenantOption(
                category=self.ANALYTICS_MANAGEMENT_REPOSITORIES,
                key=repository.get("id"),
                value=json.dumps(value_dict),
            )
            tenant.tenant_options.create(option)
            self._logger.info(f"Updated repository: {repository.get('id')}")

        except Exception as e:
            self._logger.error(
                f"Failed to update repository {repository.get('id')}: {str(e)}"
            )
            raise

    def _delete_repositories(self, tenant, repo_ids: Set[str]) -> None:
        """Helper method to delete multiple repositories"""
        for repo_id in repo_ids:
            try:
                tenant.tenant_options.delete_by(
                    category=self.ANALYTICS_MANAGEMENT_REPOSITORIES, key=repo_id
                )
                self._logger.info(f"Deleted repository: {repo_id}")
            except Exception as e:
                self._logger.warning(f"Failed to delete repository {repo_id}: {str(e)}")

    @staticmethod
    def prepare_header(request) -> Dict:
        # headers = dict(request.headers)
        # if "authorization" in request.cookies:
        #     headers["Authorization"] = f"Bearer {request.cookies['authorization']}"
        return [request.headers, request.cookies]
