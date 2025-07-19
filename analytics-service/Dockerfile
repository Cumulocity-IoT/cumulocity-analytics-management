# Use the base image
FROM public.ecr.aws/apama/apama-builder:latest

# Set the working directory
WORKDIR /apama_work

# Switch to root user
USER root

# Install runtime dependencies - try different package managers
RUN (command -v dnf && dnf install -y git && dnf clean all) || \
    (command -v yum && yum install -y git && yum clean all) || \
    (command -v apt-get && apt-get update && apt-get install -y git && apt-get clean) || \
    (command -v apk && apk add --no-cache git)

# Clone SDK with minimal history
RUN git clone --depth 1 https://github.com/Cumulocity-IoT/apama-analytics-builder-block-sdk.git

# Install Python dependencies
COPY requirements.txt /apama_work/
RUN pip3 install --upgrade pip
RUN pip3 install -r requirements.txt

# Copy application files
COPY flask_wrapper.py c8y_agent.py extension_builder.py monitor_downloader.py solution_utils.py /apama_work/

# Set the default command
CMD ["python3", "flask_wrapper.py"]