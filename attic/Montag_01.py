from flask import request
import logging
import requests
from flask import Flask, request, jsonify, send_file, make_response
import logging
#from github import Github
import tempfile
import os
import re
import urllib.parse


logging.basicConfig(
    level=logging.DEBUG,
    format="[%(asctime)s] %(levelname)s [%(name)s.%(funcName)s:%(lineno)d] %(message)s",
    datefmt="%d/%b/%Y %H:%M:%S",
)
logger = logging.getLogger("flask_wrapper")
logger.setLevel(logging.INFO)

app = Flask(__name__)

# delimiters = r'[/?]'

# monitor = "https://api.github.com/repos/SoftwareAG/apama-analytics-builder-block-sdk/contents/samples/blocks/CreateEvent.mon?ref=rel/10.18.0.x"
# parts = re.split(delimiters, monitor)
# logger.info(f"Variable: {parts}")
# organization = parts[4]
# repository_name = parts[5]
# file_path = "/".join(
#     parts[7:-2]
# )  # Extract path excluding "contents" and "ref"
# file_name = parts[-2]  # Extract path excluding "contents" and "ref"

#logger.info(f"Variable: {organization} {file_path}")

@app.route("/repository/<repository>/content", methods=["GET"])
def get_content(repository):  
    try:  
        encoded_url = request.args.get('url')
        logger.info(f"Get content encoded_url: {repository} {encoded_url}")
        
        decoded_url = urllib.parse.unquote(encoded_url)
        logger.info(f"Get content decoded_url: {decoded_url}")
        monitor_code = requests.get(decoded_url, allow_redirects=True)
        logger.info(f"Response: {monitor_code}")
        response = make_response(monitor_code.content, 200)
        response.mimetype = "text/plain"
        return response
        # return f"{monitor_code.content}", 200
    except Exception as e:
        logger.error(f"Exception when retrieving content extension!", exc_info=True)
        return f"Bad request: {str(e)}", 400
    

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=9080, debug=False)
