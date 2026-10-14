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
# The base image ships a distro-managed Python (PEP 668, "externally-managed-environment"), so
# system-wide pip installs need this opt-in. The distro's own pip is deliberately NOT upgraded
# (it is managed by the package manager and cannot be uninstalled by pip).
ENV PIP_BREAK_SYSTEM_PACKAGES=1
COPY requirements.txt /apama_work/
RUN pip3 install --no-cache-dir -r requirements.txt

# Copy application files
COPY app.py c8y_agent.py solution_utils.py logging_config.py /apama_work/

# Set the default command
CMD ["gunicorn", "--bind", "0.0.0.0:80", "--workers", "2", "--threads", "4", "--timeout", "120", "app:app"]