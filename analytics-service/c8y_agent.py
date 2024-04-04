import logging
import requests
from dotenv import load_dotenv
from c8y_api.app import MultiTenantCumulocityApp
from c8y_api.model import Binary
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
    PATH_CEP_RESTART = "/service/cep/restart"
    def __init__(self):
        self._logger = logging.getLogger("C8YAgent")
        self._logger.setLevel(logging.DEBUG)
        load_dotenv()
        # c8y
        self.c8yapp = MultiTenantCumulocityApp()

    def upload_extension(self, extension_name, ext_file, request_headers):
        b = Binary(
            c8y=self.c8yapp.get_tenant_instance(headers=request_headers),
            type="application/zip",
            name=f"{extension_name}",
            file=ext_file,
            pas_extension=extension_name,
        ).create()

        return b.id

    def restart_cep(self, request_headers):
        try:
            self._logger.info(f"Restarting CEP ...")
            self.c8yapp.get_tenant_instance(headers=request_headers).put(
                resource=self.PATH_CEP_RESTART, json={}
            )
        except Exception as e:
            self._logger.error(f"Exception:", exc_info=True)
            # for keys,values in request_headers.items():
            #     self._logger.info(f"Headers: {keys} {values}")

        self._logger.info(f"Restarted CEP!")

    def get_cep_operationobject_id(self, request_headers):
        try:
            self._logger.info(f"Retrieving id of operation object for CEP ...")
            
            response = self.c8yapp.get_tenant_instance(headers=request_headers).get(
                    resource=self.PATH_CEP_DIAGNOSTICS)
            try:
                app_id = response["microservice_application_id"]
                microservice_name = response["microservice_name"]
                cep_operationobject_id = None
                query = f"applicationId eq '{app_id}' and name eq '{microservice_name}'"

                self._logger.info(f"Build filter: {query}")
                
                managed_objects_app = self.c8yapp.get_tenant_instance(
                    headers=request_headers
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

    def get_cep_ctrl_status(self, request_headers):
        try:
            self._logger.info(f"Retrieving CEP control status ...")
            
            response = self.c8yapp.get_tenant_instance(headers=request_headers).get(
                    resource=self.PATH_CEP_DIAGNOSTICS)
            return response
        except Exception as e:
            self._logger.error(f"Exception:", exc_info=True)
            # for keys,values in request_headers.items():
            #     self._logger.info(f"Headers: {keys} {values}")
