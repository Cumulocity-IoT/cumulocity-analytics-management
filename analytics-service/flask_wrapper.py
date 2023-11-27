from requests import HTTPError
from flask import Flask, request, jsonify, send_file
import logging
from github import Github
import tempfile
import os
import re
import io
import subprocess

app = Flask(__name__)
# initialize github endpoint
gh = Github()
# define work directory
WORK_DIR_BASE = "/tmp/builder"
# define logging
logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] %(levelname)s [%(name)s.%(funcName)s:%(lineno)d] %(message)s",
    datefmt="%d/%b/%Y %H:%M:%S",
)
logger = logging.getLogger("flask_wrapper")
logger.setLevel(logging.INFO)


@app.route("/health")
def health():
    return '{"status":"UP"}'


@app.route("/extension", methods=["POST"])
def create_extension():
    # sample url
    # "https://api.github.com/repos/SoftwareAG/apama-analytics-builder-block-sdk/contents/samples/blocks/CreateEvent.mon?ref=rel/10.18.0.x"

    # extract parameter
    data = request.get_json()
    try:
        extension_name = data.get("extension_name", "")
        monitors = data.get("monitors", False)
        if extension_name != "":
            with tempfile.TemporaryDirectory() as work_temp_dir:
                logger.info(
                    f"Create extension POST for {work_temp_dir} {extension_name} {monitors} "
                )
                # step 1: download all monitors
                for monitor in monitors:
                    organization, repository_name, file_path, file_name = extract_path(
                        monitor
                    )
                    logger.info(
                        f"File ( path / file_name ) : ({file_path} / {file_name} )"
                    )

                    # get repository
                    repo = gh.get_repo(f"{organization}/{repository_name}")

                    # get the contents of the file
                    try:
                        file_content = repo.get_contents(file_path).decoded_content

                        # Combine output directory and filename
                        logger.info(f"File downloaded and saved to: {file_name}")

                        named_file = open(os.path.join(work_temp_dir, file_name), "wb")
                        named_file.write(file_content)
                        named_file.close()

                    except Exception as e:
                        logger.info(
                            f"Error downloading file: {file_path} {monitor} {e}"
                        )

                files_in_directory = [
                    f
                    for f in os.listdir(work_temp_dir)
                    if os.path.isfile(os.path.join(work_temp_dir, f))
                ]
                for file_name in files_in_directory:
                    logger.info(f"File in work_temp_dir: {file_name}")

                # step 2: run analytics_builder script
                # analytics_builder build extension --input work_temp_dir --output zip_name
                zip_name = f"{extension_name}.zip"
                # subprocess.call(["analytics_builder", "build extension", f"--input {work_temp_dir}", f"--output {zip_name}"])

                # step 3 : return result
                # extension_result = f"{work_temp_dir}/{zip_name}"

    except Exception as e:
        logger.error(f"Exception synchronisation!", exc_info=True)

    with open(f"/tmp/builder/Math_AB_Extension.zip", "rb") as extension_zip:
        return send_file(
            io.BytesIO(extension_zip.read()),
            # attachment_filename=f"{extension_name}.zip",
            mimetype="zip",
        )


def extract_path(path):
    # Extract information from the API URL
    delimiters = r"[/?]"
    parts = re.split(delimiters, path)
    organization = parts[4]
    repository_name = parts[5]
    file_path = "/".join(parts[7:-2])  # Extract path excluding "contents" and "ref"
    file_name = parts[-3]  # Extract path excluding "contents" and "ref"
    return organization, repository_name, file_path, file_name


if __name__ == "__main__":
    # app.run(host="0.0.0.0", port=80, debug=False)
    app.run(host="127.0.0.1", port=9080, debug=False)
