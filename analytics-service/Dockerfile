# Use the base image
FROM public.ecr.aws/apama/apama-builder:10.15-ubi9

# Set the working directory
WORKDIR /apama_work

USER root

# Install only the necessary packages
RUN microdnf install -y git tar


# FROM python:3-slim

# # Set the working directory
# WORKDIR /apama_work

# USER root

# Install only the necessary packages
# RUN apt-get update && apt-get install -y \
#     git \
#     tar \
#     && rm -rf /var/lib/apt/lists/*  # Clean up to reduce image size

# Clone the apama-analytics-builder-block-sdk repository
RUN git clone https://github.com/Cumulocity-IoT/apama-analytics-builder-block-sdk.git

# Alternatively
# RUN wget https://github.com/Cumulocity-IoT/apama-analytics-builder-block-sdk/archive/refs/heads/rel/10.18.0.x.zip
# RUN unzip apama-analytics-builder-block-sdk-rel-10.18.0.x.zip

COPY requirements.txt /apama_work
COPY flask_wrapper.py /apama_work
COPY c8y_agent.py /apama_work

# Used for test purposes
RUN mkdir -p /tmp/builder

RUN pip3 install --upgrade pip
RUN pip3 install -r requirements.txt

CMD ["python3", "flask_wrapper.py"]