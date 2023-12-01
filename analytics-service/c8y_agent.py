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
        try:
            self._logger.info(f"Restarted CEP Format 1")
            result = self.c8y_client.put(resource="/service/cep/restart", json="")
        except Exception as e:
            self._logger.error(f"Ignoring exceptiom!", exc_info=True)
            # try:
            #     self._logger.info(f"Restarted CEP Format 2")
            #     result = self.c8y_client.put(resource="/service/cep/restart", json={})
            # except:
            #     self._logger.info(f"Restarted CEP Format 3")
            #     result = self.c8y_client.put(
            #         resource="/service/cep/restart", json=json.dumps({})
            #     )

        self._logger.info(f"Restarted CEP {json.dumps(result) } as {id}")
