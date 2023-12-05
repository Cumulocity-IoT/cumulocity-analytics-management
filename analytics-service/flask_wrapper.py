from requests import HTTPError
import requests
from flask import Flask, request, jsonify, send_file, make_response
import logging

# from github import Github
import tempfile
import os
import re
import io
import subprocess
import urllib.parse
from c8y_agent import C8YAgent

# from github import Auth

# define logging
logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] %(levelname)s [%(name)s.%(funcName)s:%(lineno)d] %(message)s",
    datefmt="%d/%b/%Y %H:%M:%S",
)
logger = logging.getLogger("flask_wrapper")
logger.setLevel(logging.INFO)

app = Flask(__name__)
agent = C8YAgent()


@app.route("/health")
def health():
    return '{"status":"UP"}'

# this endpoint was only exposed for test purposes
# @app.route("/service/cep/restart", methods=["PUT"])
# def restart():
#     agent.restart_cep(request_headers=request.headers)
#     return f"OK", 200

# download the content from github
# params:
#    url                     url of monitor to download
#    extract_fqn_cep_block   extract the fqn name from the monitor file
#    cep_block_name          block name, required to return the fqn name, including the Apama package
@app.route("/repository/<repository>/content", methods=["GET"])
def get_content(repository):
    try:
        encoded_url = request.args.get("url")
        cep_block_name = request.args.get("cep_block_name")
        extract_fqn_cep_block = request.args.get("extract_fqn_cep_block", type=bool)
        logger.info(f"Get content encoded_url: {repository} {encoded_url}")

        decoded_url = urllib.parse.unquote(encoded_url)
        logger.info(f"Get content decoded_url: {decoded_url}")
        monitor_code = requests.get(decoded_url, allow_redirects=True)
        if extract_fqn_cep_block:
            regex = "(package\s)(.*?);"
            package = re.findall(regex, monitor_code.text)
            try:
                fqn = package[0][1] + "." + cep_block_name
                logger.info(f"Return only fqn of block: {fqn}")
                response = make_response(fqn, 200)
                response.mimetype = "text/plain"
                return response
            except Exception as e:
                logger.error(f"Exception when retrieving fqn !", exc_info=True)
                return f"Bad request: {str(e)}", 400
        else:
            logger.info(f"Response: {monitor_code}")
            response = make_response(monitor_code.content, 200)
            response.mimetype = "text/plain"
            return response
    except Exception as e:
        logger.error(f"Exception when retrieving content extension!", exc_info=True)
        return f"Bad request: {str(e)}", 400


@app.route("/extension", methods=["POST"])
def create_extension():
    # sample url
    # "https://api.github.com/repos/SoftwareAG/apama-analytics-builder-block-sdk/contents/samples/blocks/CreateEvent.mon?ref=rel/10.18.0.x"

    # extract parameter
    data = request.get_json()
    result_extension_file = ""
    result_extension_absolute = ""
    extension_name = data.get("extension_name", "")
    monitors = data.get("monitors", [])
    upload = data.get("upload", False)
    deploy = data.get("deploy", False)

    if extension_name != "":
        with tempfile.TemporaryDirectory() as work_temp_dir:
            try:
                logger.info(f"Create extension for: {extension_name} {monitors} ")
                logger.info(f"... in temp dir: {work_temp_dir}")
                # step 1: download all monitors
                for monitor in monitors:

                    # get the contents of the file
                    try:
                        file_name = extract_raw_path(monitor)
                        monitor_code = requests.get(monitor, allow_redirects=True)

                        # Combine output directory and filename
                        logger.debug(f"File downloaded and saved to: {file_name}")

                        named_file = open(os.path.join(work_temp_dir, file_name), "wb")
                        named_file.write(monitor_code.content)
                        named_file.close()

                    except Exception as e:
                        logger.error(f"Error downloading file:  {monitor} {e}")

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
                    if not upload:
                        return send_file(
                            io.BytesIO(extension_zip.read()),
                            mimetype="zip",
                        )
                    else:
                        id = agent.upload_extension(
                            extension_name,
                            extension_zip,
                            request_headers=request.headers,
                        )
                        logger.info(
                            f"Uploaded extension {extension_name} as {id} and restart: {deploy}"
                        )
                        if deploy:
                            agent.restart_cep(request_headers=request.headers)
                        return "", 201

            except Exception as e:
                logger.error(f"Exception when creating extension!", exc_info=True)
                return f"Bad request: {str(e)}", 400


def extract_path(path):
    # Extract information from the API URL
    delimiters = r"[/?]"
    parts = re.split(delimiters, path)
    organization = parts[4]
    repository_name = parts[5]
    file_path = "/".join(parts[7:-2])  # Extract path excluding "contents" and "ref"
    file_name = parts[-3]  # Extract path excluding "contents" and "ref"
    return organization, repository_name, file_path, file_name


def extract_raw_path(path):
    # Extract information from the raw API URL
    return path.rsplit("/", 1)[-1]


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=80, debug=False)
