# Use the base image
FROM softwareag/apama-cumulocity-builder:10.15

# Set the working directory
WORKDIR /apama_work

USER root

RUN microdnf install git

# USER sagadmin
# Clone the apama-analytics-builder-block-sdk repository
RUN git clone https://github.com/SoftwareAG/apama-analytics-builder-block-sdk.git

COPY requirements.txt /apama_work
COPY flask_wrapper.py /apama_work
# Used for tes purposes
RUN mkdir -p /tmp/builder
#COPY Math_AB_Extension.zip /tmp/builder/

RUN pip3 install --upgrade pip
RUN pip3 install -r requirements.txt

CMD ["python3", "flask_wrapper.py"]