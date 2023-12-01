import logging
from dotenv import load_dotenv
from c8y_api.app import SimpleCumulocityApp
from c8y_api.model import Binary
import json


class C8YAgent:
    def __init__(self):
        self._logger = logging.getLogger("C8YAgent")
        self._logger.setLevel(logging.INFO)
        load_dotenv()
        # c8y
        self.c8y_client = SimpleCumulocityApp()

    def upload_extension(self, name, ext_file):
        b = Binary(
            c8y=self.c8y_client,
            type="ab_ext_bin",
            name=name,
            file=ext_file,
            pas_extension={},
        ).create()

        return b.id

    def restart_cep(self):
        result = self.c8y_client.put(
            resource="/service/cep/restart",
            json={},
        )
        self._logger.info(f"Restarted CEP {json.dumps(result) } as {id}")
