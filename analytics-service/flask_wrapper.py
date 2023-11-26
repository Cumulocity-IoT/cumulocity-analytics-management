from requests import HTTPError
from flask import Flask, request, jsonify, send_file
import logging
from github import Github
import tempfile
import os
import re
import io

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
    # "https://api.github.com/repos/SoftwareAG/apama-analytics-builder-block-sdk/contents/samples/blocks/CreateEvent.mon?ref=rel/10.18.0.x"
    # create tempdir
    #work_temp_dir = tempfile.NamedTemporaryFile()
    #work_temp_dir = '/tmp/builder'
    delimiters = r'[/?]'
    
    # extract parameter
    data = request.get_json()
    result = {}
    try:
        extension_name = data.get("extension_name", "")
        monitors = data.get("monitors", False)
        if extension_name != "":
            with tempfile.TemporaryDirectory() as work_temp_dir:
                logger.info(f"Create extension POST for  {work_temp_dir} {extension_name} {monitors} ")
                for monitor in monitors:
                    # Extract information from the API URL
                    parts = re.split(delimiters, monitor)
                    organization = parts[4]
                    repository_name = parts[5]
                    file_path = "/".join(
                        parts[7:-2]
                    )  # Extract path excluding "contents" and "ref"
                    
                    file_name = parts[-3]  # Extract path excluding "contents" and "ref"
                    logger.info(f"File ( path / file_name ) : ({file_path} / {file_name} )")

                    # Get the repository
                    repo = gh.get_repo(f"{organization}/{repository_name}")

                    # Get the contents of the file
                    try:
                        file_content = repo.get_contents(file_path).decoded_content

                        # Combine output directory and filename
                        logger.info(f"File downloaded and saved to: {file_name}")
                        # output_path = os.path.join(work_temp_dir.name, file_name)
                        # logger.info(f"File downloaded and saved to: {output_path}")

                        # Write the content to the local file
                        # with open(output_path, "wb") as file:
                        #     file.write(file_content)
                        
                        named_file = open(os.path.join(work_temp_dir, file_name), 'wb')
                        named_file.write(file_content)
                        named_file.close()

                    except Exception as e:
                        logger.info(f"Error downloading file: {output_path} {monitor} {e}")
            
                # Iterate directory
                # for file_path in os.listdir(work_temp_dir):
                #     logger.info(f"File in work_temp_dir: {file_path}")
                
                files_in_directory = [f for f in os.listdir(work_temp_dir) if os.path.isfile(os.path.join(work_temp_dir, f))]
                for file_name in files_in_directory:
                    logger.info(f"File in work_temp_dir: {file_name}")


    except Exception as e:
        logger.error(f"Exception synchronisation!", exc_info=True)

    # # use work_dir, and when done:
    # work_temp_dir.cleanup()

    with open(f"/tmp/builder/Math_AB_Extension.zip", "rb") as extension_zip:
        return send_file(
            io.BytesIO(extension_zip.read()),
            #attachment_filename=f"{extension_name}.zip",
            mimetype="zip",
        )


if __name__ == "__main__":
    #app.run(host="0.0.0.0", port=80, debug=False)
    app.run(host="127.0.0.1", port=9080, debug=False)
