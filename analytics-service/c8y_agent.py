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
            name=f"{extension_name}.zip",
            file=ext_file,
            pas_extension=extension_name,
        ).create()

        return b.id

    def restart_cep(self,request_headers):
        try:
            self._logger.info(f"Restarting CEP ...")
            self.c8yapp.get_tenant_instance(headers=request_headers).put(resource="/service/cep/restart", json={})
        except Exception as e:
            self._logger.error(f"Ignoring exceptiom!", exc_info=True)
            # for keys,values in request_headers.items():
            #     self._logger.info(f"Headers: {keys} {values}")

        self._logger.info(f"Restarted CEP!")
