from requests import HTTPError
from flask import Flask, request, jsonify, send_file
import logging
from github import Github
import tempfile

app = Flask(__name__)
# initialize github endpoint
gh = Github()
# define work directory
WORK_DIR_BASE = '/tmp/builder'
# define logging
logging.basicConfig(
    level=logging.DEBUG,
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
    
    # create tempdir
    work_temp_dir = tempfile.TemporaryDirectory()
    print(work_temp_dir.name)

    # extract parameter
    data = request.get_json()
    result = {}
    try:
        extension_name = data.get("extension_name", "")
        monitors = data.get("monitors", False)
        logger.info(f"Create extension POST for {extension_name} {monitors}")
        if extension_name == []:
            for monitor in monitors:
                # Extract information from the API URL
                parts = monitor.split("/?")
                organization = parts[4]
                repository_name = parts[5]
                file_path = "/".join(parts[8:-1])  # Extract path excluding "contents" and "ref"
                file_name = parts[7]  # Extract path excluding "contents" and "ref"
                
                # Get the repository
                repo = gh.get_repo(f"{organization}/{repository_name}")
                
                # Get the contents of the file
                try:
                    file_content = repo.get_contents(file_path).decoded_content

                    # Combine output directory and filename
                    output_path = os.path.join(work_temp_dir, file_name)

                    # Write the content to the local file
                    with open(output_path, 'wb') as file:
                        file.write(file_content)

                    logger.info(f"File downloaded and saved to: {output_path}")
                except Exception as e:
                     logger.info(f"Error downloading file: {monitor} {e}")

    except Exception as e:
        logger.error(f"Exception synchronisation!", exc_info=True)
        
    
    # use work_dir, and when done:
    work_temp_dir.cleanup()
    
    with open(f"/tmp/builder/Math_AB_Extension.zip", 'rb') as extension_zip:
        return send_file(
                        io.BytesIO(extension_zip.read()),
                        attachment_filename=f"{extension_name}.zip",
                        mimetype='zip'
                )
    
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=80, debug=False)