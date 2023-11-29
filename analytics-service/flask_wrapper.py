from requests import HTTPError
import requests
from flask import Flask, request, jsonify, send_file
import logging
#from github import Github
import tempfile
import os
import re
import io
import subprocess
from c8y_agent import C8YAgent
#from github import Auth

# define logging
logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] %(levelname)s [%(name)s.%(funcName)s:%(lineno)d] %(message)s",
    datefmt="%d/%b/%Y %H:%M:%S",
)
logger = logging.getLogger("flask_wrapper")
logger.setLevel(logging.INFO)

app = Flask(__name__)
#agent = C8YAgent()
#access_token = agent.get_github_access_token()
# logger.info(
#     f"Github access token: {access_token}"
# )
#auth = Auth.Token(access_token)
# initialize github endpoint
#gh = Github(auth=auth)


@app.route("/health")
def health():
    return '{"status":"UP"}'


@app.route("/extension", methods=["POST"])
def create_extension():
    # sample url
    # "https://api.github.com/repos/SoftwareAG/apama-analytics-builder-block-sdk/contents/samples/blocks/CreateEvent.mon?ref=rel/10.18.0.x"

    # extract parameter
    data = request.get_json()
    result_extension_file = ""
    result_extension_absolute = ""
    extension_name = data.get("extension_name", "")
    monitors = data.get("monitors", False)

    if extension_name != "":
        with tempfile.TemporaryDirectory() as work_temp_dir:
            try:
                logger.info(f"Create extension for: {extension_name} {monitors} ")
                logger.info(f"... in temp dir: {work_temp_dir}")
                # step 1: download all monitors
                for monitor in monitors:
                    #organization, repository_name, file_path, file_name = extract_path(
                    #    monitor
                    #)
                    # logger.info(
                    #     f"File ( path / file_name ) : ({file_path} / {file_name} )"
                    # )

                    # get repository
                    #repo = gh.get_repo(f"{organization}/{repository_name}")

                    # get the contents of the file
                    try:
                        # file_content = repo.get_contents(file_path).decoded_content
                        file_name = monitor.rsplit("/", 1)[-1]
                        logger.info(f"filename: {file_name}")
                        r = requests.get(monitor, allow_redirects=True)

                        # Combine output directory and filename
                        logger.debug(f"File downloaded and saved to: {file_name}")

                        named_file = open(os.path.join(work_temp_dir, file_name), "wb")
                        named_file.write(r.content)
                        named_file.close()

                    except Exception as e:
                        logger.error(
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
                result_extension_file = f"{extension_name}.zip"
                result_extension_absolute = f"{work_temp_dir}/{result_extension_file}"
                subprocess.call(
                    [
                        "/apama_work/apama-analytics-builder-block-sdk/analytics_builder",
                        "build",
                        "extension",
                        "--input",
                        f"{work_temp_dir}",
                        "--output",
                        f"{result_extension_absolute}",
                    ]
                )

                size = os.path.getsize(result_extension_absolute)
                logger.info(f"Returning: {result_extension_absolute} with size {size}")

                with open(result_extension_absolute, "rb") as extension_zip:
                    return send_file(
                        io.BytesIO(extension_zip.read()),
                        # attachment_filename=f"{extension_name}.zip",
                        mimetype="zip",
                    )

            except Exception as e:
                logger.error(f"Exception when creating extension!", exc_info=True)
                f"Bad request: {+ str(e)}", 400


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
    app.run(host="0.0.0.0", port=80, debug=False)
