import logging
from sre_constants import CATEGORY
import requests
from dotenv import load_dotenv
from c8y_api.app import MultiTenantCumulocityApp
from c8y_api.model import Binary, TenantOption
import json


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


class C8YAgent:
    PATH_CEP_DIAGNOSTICS = "/service/cep/diagnostics/apamaCtrlStatus"
    PATH_TENANT_OPTIONS = "/tenant/options"
    PATH_CEP_RESTART = "/service/cep/restart"
    ANALYTICS_MANAGEMENT_REPOSITORIES = "analytics-management.repository"
    def __init__(self):
        self._logger = logging.getLogger("C8YAgent")
        self._logger.setLevel(logging.DEBUG)
        load_dotenv()
        # c8y
        self.c8yapp = MultiTenantCumulocityApp()
        dir(self.c8yapp)

    def upload_extension(self, request, extension_name, ext_file):
        headers={**request.headers, **request.cookies}
        b = Binary(
            c8y=self.c8yapp.get_tenant_instance(headers=headers),
            type="application/zip",
            name=f"{extension_name}",
            file=ext_file,
            pas_extension=extension_name,
        ).create()

        return b.id

    def restart_cep(self, request):
        try:
            headers={**request.headers, **request.cookies}
            self._logger.info(f"Restarting CEP ...")
            self.c8yapp.get_tenant_instance(headers=headers).put(
                resource=self.PATH_CEP_RESTART, json={}
            )
        except Exception as e:
            self._logger.error(f"Exception:", exc_info=True)
            # for keys,values in request_headers.items():
            #     self._logger.info(f"Headers: {keys} {values}")

        self._logger.info(f"Restarted CEP!")

    def get_cep_operationobject_id(self, request):
        try:
            self._logger.info(f"Retrieving id of operation object for CEP ...")
            
            headers={**request.headers, **request.cookies}
            response = self.c8yapp.get_tenant_instance(headers=headers).get(
                    resource=self.PATH_CEP_DIAGNOSTICS)
            try:
                app_id = response["microservice_application_id"]
                microservice_name = response["microservice_name"]
                cep_operationobject_id = None
                query = f"applicationId eq '{app_id}' and name eq '{microservice_name}'"

                self._logger.info(f"Build filter: {query}")
                
                managed_objects_app = self.c8yapp.get_tenant_instance(
                    headers=headers 
                ).inventory.select(query=query)
                managed_object_id = None
                for managed_object in managed_objects_app:
                    self._logger.info(
                        f"Found managed object: {managed_object.id} for cep app: {app_id}"
                    )
                    managed_object_id = managed_object
                    cep_operationobject_id = managed_object_id.id
                    break
                if managed_object_id == None:
                    self._logger.error(f"Not found !")
                    return None
                return {"id": cep_operationobject_id}
            except:
                self._logger.error(
                    f"Error finding app id: {app_id}",
                    exc_info=True,
                )
        except Exception as e:
            self._logger.error(f"Exception:", exc_info=True)
            # for keys,values in request_headers.items():
            #     self._logger.info(f"Headers: {keys} {values}")

    def get_cep_ctrl_status(self, request):
        try:
            self._logger.info(f"Retrieving CEP control status ...")
            
            headers={**request.headers, **request.cookies}
            response = self.c8yapp.get_tenant_instance(headers=headers).get(
                    resource=self.PATH_CEP_DIAGNOSTICS)
            return response
        except Exception as e:
            self._logger.error(f"Exception:", exc_info=True)
            # for keys,values in request_headers.items():
            #     self._logger.info(f"Headers: {keys} {values}")

    def load_repositories(self, request):
        try:
            self._logger.info(f"Retrieving repositories ...")
            
            # tenant_options = self.c8yapp.get_tenant_instance(headers=request_headers).tenant_options.get_all(category=self.ANALYTICS_MANAGEMENT_REPOSITORIES)
            
            headers={**request.headers, **request.cookies}
            response = self.c8yapp.get_tenant_instance(headers=headers).get(
                    resource=f"{self.PATH_TENANT_OPTIONS}/{self.ANALYTICS_MANAGEMENT_REPOSITORIES}")
            tenant_options = response
            # List comprehension to convert TenantOptions to array
            repositories = []
            for repository_id in tenant_options:
                # Assuming option.value is a JSON string containing repository details
                value_dict = json.loads(tenant_options[repository_id])
                
                repository = {
                    'id': repository_id,
                    'name': value_dict.get('name'),
                    'url': value_dict.get('url'),
                    'accessToken': value_dict.get('accessToken'),
                    'enabled': value_dict.get('enabled', False)  # Default to False if not present
                }
                repositories.append(repository)
            self._logger.info(f"Found repositories: {repositories}")
            return repositories
        except Exception as e:
            self._logger.error(f"Exception:", exc_info=True)
            
    def load_repository(self, request, repository_id):
        try:
            self._logger.info(f"Retrieving repository {repository_id} ...")
            
            # tenant_options = self.c8yapp.get_tenant_instance(headers=request_headers).tenant_options.get_all(category=self.ANALYTICS_MANAGEMENT_REPOSITORIES)
            
            headers={**request.headers, **request.cookies}
            response = self.c8yapp.get_tenant_instance(headers=headers).get(
                    resource=f"{self.PATH_TENANT_OPTIONS}/{self.ANALYTICS_MANAGEMENT_REPOSITORIES}/{repository_id}")
            tenant_option = response
            # List comprehension to convert TenantOptions to array
            repository = {}
            # Assuming option.value is a JSON string containing repository details
            value_dict = json.loads(tenant_option['value'])
            
            repository = {
                'id': repository_id,
                'name': value_dict.get('name'),
                'url': value_dict.get('url'),
                'accessToken': value_dict.get('accessToken'),
                'enabled': value_dict.get('enabled', False)  # Default to False if not present
            }
            self._logger.info(f"Found repository: {repository}")
            return repository
        except Exception as e:
            self._logger.error(f"Exception:", exc_info=True)

    def save_repositories(self, request, repositories):
        try:
            self._logger.info(f"Saving repositories...")
            headers={**request.headers, **request.cookies}
            tenant = self.c8yapp.get_tenant_instance(headers=headers)

            for repository in repositories:
                repository_id = repository.get('id')
                # Create value dictionary excluding the id field
                value_dict = {
                    'name': repository.get('name'),
                    'url': repository.get('url'),
                    'enabled': bool(repository.get('enabled', False))
                }

                # Only add accessToken if it exists and is not empty
                if repository.get('accessToken'):
                    value_dict['accessToken'] = repository['accessToken']
                
                # Convert to JSON string
                value_json = json.dumps(value_dict)
                # self._logger.info(f"Updating repository: {repository_id} {value_dict} {value_json}")

                option = TenantOption(category=self.ANALYTICS_MANAGEMENT_REPOSITORIES,
                        key=repository_id,
                        value=value_json)
                # Try to update existing repository
                tenant.tenant_options.create(option)
                self._logger.info(f"Updated/created repository: {repository_id}")

            return {"message": "Repositories saved successfully"}, 200

        except Exception as e:
            self._logger.error(f"Exception while saving repositories:", exc_info=True)
            return {"error": str(e)}, 500
