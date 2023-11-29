import logging
from dotenv import load_dotenv
from c8y_api.app import SimpleCumulocityApp
from c8y_api.model import Binary
class C8YAgent:

    def __init__(self):
        self._logger = logging.getLogger("C8YAgent")
        self._logger.setLevel(logging.INFO)

        load_dotenv()

        # c8y
        self.c8y_client = SimpleCumulocityApp()

        # load config values from tenant options
        # self.github_access_token = self.c8y_client.tenant_options.get_value(
        #     "github", "credentials.access_token"
        # )

    def get_github_access_token(self):
        return self.github_access_token
    def upload_extension(self, name ,ext_file):
        b = Binary(c8y=self.c8y_client,type='ab_ext_bin',name=name,file=ext_file,pas_extension={}).create()
        self._logger.info(f"Uploaded extension {name} as {b.id}")



 