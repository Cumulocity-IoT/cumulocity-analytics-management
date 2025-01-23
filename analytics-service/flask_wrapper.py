import requests
from flask import Flask, request, Response, send_file, make_response, jsonify
import logging

# from github import Github
import tempfile
import os
import re
import io
import subprocess
import urllib.parse
from c8y_agent import C8YAgent
import json

# from github import Auth

# define logging
logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] %(levelname)s [%(name)s.%(funcName)s:%(lineno)d] %(message)s",
    datefmt="%d/%b/%Y %H:%M:%S",
)
# logging.getLogger("urllib3").setLevel(logging.DEBUG)
logger = logging.getLogger("flask_wrapper")
logger.setLevel(logging.INFO)

app = Flask(__name__)
agent = C8YAgent()


@app.route("/health")
def health():
    return '{"status":"UP"}'


# download the content from github
# params:
#    url                     url of monitor to download
#    extract_fqn_cep_block   extract the fqn name from the monitor file
#    cep_block_name          block name, required to return the fqn name, including the Apama package
@app.route("/repository/contentList", methods=["GET"])
def get_content_list():
    try:
        encoded_url = request.args.get("url")
        repository_id = request.args.get("id")
        headers = {
        'Accept': 'application/json'
        }
        if repository_id:
            repository_configuration = agent.load_repository(request_headers=request.headers, request_cookies=request.cookies, repository_id=repository_id)
            if "accessToken" in repository_configuration:
                headers["Authorization"] = f"token {repository_configuration['accessToken']}"
                logger.info(f"Found accessToken: {headers['Authorization']}")
                
        logger.info(
            f"Get content list encoded_url: {repository_configuration} {encoded_url}"
        )

        decoded_url = urllib.parse.unquote(encoded_url)
        logger.info(f"Get content list from decoded_url: {decoded_url}")
        response_repository = requests.get(decoded_url, headers=headers, allow_redirects=True)
        response_repository.raise_for_status() 

        logger.info(f"Response: {response_repository}")
        response = make_response(response_repository.content, 200)
        response.mimetype = "application/json"
        return response
    except Exception as e:
        logger.error(f"Exception when retrieving content list!", exc_info=True)
        resp = Response(
            json.dumps({"message": f"Bad request: {str(e)}"}), mimetype="application/json"
        )
        resp.status_code = 400
        return resp

# download the content from github
# params:
#    url                     url of monitor to download
#    extract_fqn_cep_block   extract the fqn name from the monitor file
#    cep_block_name          block name, required to return the fqn name, including the Apama package
@app.route("/repository/content", methods=["GET"])
def get_content():
    try:
        encoded_url = request.args.get("url")
        cep_block_name = request.args.get("cep_block_name")
        repository_id = request.args.get("repository_id")
        extract_fqn_cep_block = parse_boolean(request.args.get(
            "extract_fqn_cep_block", default=False
        ))
        headers = {
        'Accept': 'application/vnd.github.v3.raw'
        }
        
        if repository_id:
            repository_configuration = agent.load_repository(request_headers=request.headers, request_cookies=request.cookies, repository_id=repository_id)
            if "accessToken" in repository_configuration:
                headers["Authorization"] = f"token {repository_configuration['accessToken']}"
                logger.info(f"Found accessToken: {headers['Authorization']}")
                logger.info(
                    f"Get content encoded_url: {repository_configuration} {extract_fqn_cep_block}  {cep_block_name} {encoded_url}"
                )
        else:
            logger.info(
                f"Get content, no repository found, encoded_url: {extract_fqn_cep_block} {cep_block_name} {encoded_url}"
            )

        decoded_url = urllib.parse.unquote(encoded_url)
        logger.info(f"Get content decoded_url: {decoded_url}")
        response_repository = requests.get(decoded_url, headers=headers, allow_redirects=True)
        # logger.info(f"Response headers: {dict(response_repository.headers)}")
        # logger.info(f"Request headers: {dict(response_repository.request.headers)}")
        response_repository.raise_for_status() 
        if extract_fqn_cep_block:
            regex = "(package\s)(.*?);"
            package = re.findall(regex, response_repository.text)
            logger.info(f"Result looking for fqn of monitor packaege: {package}")

            try:
                fqn = str(package[0][1]) + "." + str(cep_block_name)
                logger.info(f"Return only fqn of block: {fqn}")
                response = make_response(fqn, 200)
                response.mimetype = "text/plain"
                return response
            except Exception as e:
                logger.error(f"Exception when retrieving fqn of monitor file!", exc_info=True)
                return f"Bad request: {str(e)}", 400
        else:
            logger.info(f"Response: {response_repository}")
            response = make_response(response_repository.content, 200)
            response.mimetype = "text/plain"
            return response
    except Exception as e:
        logger.error(f"Exception when retrieving content from github!", exc_info=True)
        resp = Response(
            json.dumps({"message": f"Bad request: {str(e)}"}), mimetype="application/json"
        )
        resp.status_code = 400
        return resp




# load the configured repositores
# params:
@app.route("/repository/configuration", methods=["GET"])
def load_repositories():
    result = agent.load_repositories(request_headers=request.headers,request_cookies=request.cookies)
    if result == None:
        resp = Response(
            json.dumps({"message": "No repositories found"}), mimetype="application/json"
        )
        resp.status_code = 400
        return resp
    
    return jsonify(result)

# save the configured repositores
# params:
@app.route('/repository/configuration', methods=['POST'])
def save_repositories():
    try:
        # Get repositories from request body
        repositories = request.get_json()
        if not isinstance(repositories, list):
            return {"error": "Request body must be an array of repositories"}, 400

        # Validate repository format
        for repo in repositories:
            if not all(key in repo for key in ['id', 'name', 'url']):
                return {"error": "Each repository must have id, name, and url"}, 400

        # Get headers from request
        request_headers = dict(request.headers)

        # Call save method
        return agent.save_repositories(request_headers , request.cookies, repositories)

    except Exception as e:
        return {"error": str(e)}, 500


@app.route("/extension", methods=["POST"])
def create_extension_zip():
    # sample url
    # "https://api.github.com/repos/Cumulocity-IoT/apama-analytics-builder-block-sdk/contents/samples/blocks/CreateEvent.mon?ref=rel/10.18.0.x"

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
                        file_name = extract_raw_path(monitor["downloadUrl"])
                        repository_configuration = agent.load_repository(request_headers=request.headers, request_cookies=request.cookies, repository_id=monitor["repositoryId"])
                        headers = {
                        'Accept': 'application/vnd.github.v3.raw'
                        }
                        if "accessToken" in repository_configuration:
                            headers["Authorization"] = f"token {repository_configuration['accessToken']}"
                            logger.info(f"Found accessToken: {headers['Authorization']}")
          
                        response_monitor_code = requests.get(monitor["url"], headers=headers, allow_redirects=True)

                        # Combine output directory and filename
                        logger.info(f"File downloaded and saved to: {file_name}")

                        named_file = open(os.path.join(work_temp_dir, file_name), "wb")
                        named_file.write(response_monitor_code.content)
                        named_file.close()

                    except Exception as e:
                        logger.error(f"Error downloading file:  {monitor}", exc_info=True)
                        resp = Response(json.dumps({"message": f"Bad request: {str(e)}"}), mimetype="application/json"
                        )
                        resp.status_code = 400
                        return resp

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
                            request.headers,
                            request.cookies,
                            extension_name,
                            extension_zip,
                        )
                        logger.info(
                            f"Uploaded extension {extension_name} as {id} and restart: {deploy}"
                        )
                        if deploy:
                            agent.restart_cep(request_headers=request.headers, request_cookies= request.cookies)
                        return "", 201

            except Exception as e:
                logger.error(f"Exception when creating extension!", exc_info=True)
                resp = Response(
                    json.dumps({"message": f"Bad request: {str(e)}"}), mimetype="application/json"
                )
                resp.status_code = 400
                return resp


# return the details for the extension
# params:
#    name                    name of monitor to download
# returns:
#    list of monitors included in the extension with the following structure
# export interface CEP_Extension {
#   name: string;
#   analytics: CEP_Block[];
#   version: string;
#   loaded: true;
# }


# export interface CEP_Block {
#   id: string;
#   name: string;
#   installed: boolean;
#   producesOutput: string;
#   description: string;
#   url: string;
#   downloadUrl: string;
#   path: string;
#   custom: boolean;
#   extension: string;
#   repositoryName: string;
#   category: Category;
# }
@app.route("/cep/extension/<name>", methods=["GET"])
def get_extension(name):
    cep_extension = {name}
    return cep_extension, 200


# return the details on all loaded extensions
# returns:
#    list of all loaded extensions with the following structure
# export interface CEP_Metadata {
#   metadatas: string[];
#   messages: string[];
# }
@app.route("/cep/extension", methods=["GET"])
def get_extension_metadata():
    cep_extension_metadata = []
    return cep_extension_metadata, 200


# return the managedObject that represents the cep ctrl microservice
# returns:
#    id
@app.route("/cep/id", methods=["GET"])
def get_cep_operationobject_id():
    result = agent.get_cep_operationobject_id(request_headers=request.headers, request_cookies= request.cookies)
    if result == None:
        resp = Response(
            json.dumps({"message": "Not found"}), mimetype="application/json"
        )
        resp.status_code = 400
        return resp
    
    return jsonify(result)


# return status of cep ctrl microservice
# returns:
#    status
# @app.route("/cep/status", methods=["GET"])
@app.route("/cep/status", methods=["GET"])
def get_cep_ctrl_status():
    result = agent.get_cep_ctrl_status(request_headers=request.headers, request_cookies= request.cookies)
    if result == None:
        resp = Response(
            json.dumps({"message": "Not found"}), mimetype="application/json"
        )
        resp.status_code = 400
        return resp
    return jsonify(result)


# this endpoint was only exposed for test purposes
# @app.route("/cep/restart", methods=["PUT"])
# def restart():
#     agent.restart_cep(request_headers=request.headers)
#     return f"OK", 200
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


def parse_boolean(value):
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.lower() == 'true'
    return False


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=80, debug=False)
