from requests import HTTPError
from flask import Flask, request, jsonify, send_file
import logging
from github import Github
import tempfile
import os
import re


logging.basicConfig(
    level=logging.DEBUG,
    format="[%(asctime)s] %(levelname)s [%(name)s.%(funcName)s:%(lineno)d] %(message)s",
    datefmt="%d/%b/%Y %H:%M:%S",
)
logger = logging.getLogger("flask_wrapper")
logger.setLevel(logging.INFO)

delimiters = r'[/?]'

monitor = "https://api.github.com/repos/SoftwareAG/apama-analytics-builder-block-sdk/contents/samples/blocks/CreateEvent.mon?ref=rel/10.18.0.x"
parts = re.split(delimiters, monitor)
logger.info(f"Variable: {parts}")
organization = parts[4]
repository_name = parts[5]
file_path = "/".join(
    parts[7:-2]
)  # Extract path excluding "contents" and "ref"
file_name = parts[-2]  # Extract path excluding "contents" and "ref"

logger.info(f"Variable: {organization} {file_path}")
