# Use the base image
FROM softwareag/apama-cumulocity-builder:10.15

# Set the working directory
WORKDIR /apama_work

USER root

RUN microdnf install git tar
# RUN microdnf install unzip

# USER sagadmin
# Clone the apama-analytics-builder-block-sdk repository
RUN git clone https://github.com/SoftwareAG/apama-analytics-builder-block-sdk.git
# alternatively
# RUN wget https://github.com/SoftwareAG/apama-analytics-builder-block-sdk/archive/refs/heads/rel/10.18.0.x.zip
# RUN unzip apama-analytics-builder-block-sdk-rel-10.18.0.x.zip

COPY requirements.txt /apama_work
COPY flask_wrapper.py /apama_work
COPY c8y_agent.py /apama_work
# Used for tes purposes
RUN mkdir -p /tmp/builder
#COPY Math_AB_Extension.zip /tmp/builder/

RUN pip3 install --upgrade pip
RUN pip3 install -r requirements.txt

CMD ["python3", "flask_wrapper.py"]