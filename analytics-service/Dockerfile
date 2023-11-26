# Use the base image
FROM softwareag/apama-cumulocity-builder

RUN apt-get update && apt-get -y upgrade

# Set the working directory
WORKDIR /usr/src/app

# Clone the apama-analytics-builder-block-sdk repository
RUN git clone https://github.com/SoftwareAG/apama-analytics-builder-block-sdk.git

COPY requirements.txt /usr/src/app
COPY flask_wrapper.py /usr/src/app
# Used for tes purposes
RUN mkdir -p /tmp/builder
COPY Math_AB_Extension.zip /tmp/builder/

RUN pip install --upgrade pip
RUN pip install -r requirements.txt

ENTRYPOINT ["python", "-u", "/flask_wrapper.py"]