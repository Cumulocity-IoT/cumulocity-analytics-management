FROM python:3.8-slim

RUN apt-get update && apt-get -y upgrade

COPY requirements.txt /
COPY flask_wrapper.py /
RUN mkdir -p /tmp/builder

COPY Math_AB_Extension.zip /tmp/builder/

RUN pip install --upgrade pip
RUN pip install -r requirements.txt


ENTRYPOINT ["python", "-u", "/flask_wrapper.py"]