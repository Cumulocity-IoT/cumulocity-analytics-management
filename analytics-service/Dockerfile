# Use the base image, pinned by digest so builds are reproducible. To update,
# pull :latest, test, and replace the digest.
FROM public.ecr.aws/apama/apama-builder:latest@sha256:bc0f9a9be248154318531cff99ecd0c75d38b3b07be820d8a1d3bfbd38fb9b61

# Set the working directory
WORKDIR /apama_work

# The base image runs as the unprivileged "apama" user; root is only needed
# to install packages and is dropped again below.
USER root

# Install runtime dependencies - try different package managers.
# libcap lets the unprivileged user bind port 80, which the platform expects.
RUN (command -v dnf && dnf install -y git libcap && dnf clean all) || \
    (command -v yum && yum install -y git libcap && yum clean all) || \
    (command -v apt-get && apt-get update && apt-get install -y git libcap2-bin && apt-get clean) || \
    (command -v apk && apk add --no-cache git libcap)

# Fetch the SDK at a pinned commit (it builds code from user-configured repositories)
ARG SDK_COMMIT=f9f182fe2fe96076bb6acd413fc5511966eb5e0f
RUN git init apama-analytics-builder-block-sdk && \
    cd apama-analytics-builder-block-sdk && \
    git fetch --depth 1 https://github.com/Cumulocity-IoT/apama-analytics-builder-block-sdk.git ${SDK_COMMIT} && \
    git checkout --quiet FETCH_HEAD

# Install Python dependencies
# The base image ships a distro-managed Python (PEP 668, "externally-managed-environment"), so
# system-wide pip installs need this opt-in. The distro's own pip is deliberately NOT upgraded
# (it is managed by the package manager and cannot be uninstalled by pip).
ENV PIP_BREAK_SYSTEM_PACKAGES=1
COPY requirements.txt /apama_work/
RUN pip3 install --no-cache-dir -r requirements.txt

# Allow only this one capability on the interpreter, so the service can listen on port 80
RUN setcap cap_net_bind_service=+ep "$(readlink -f "$(command -v python3)")"

# Copy application files
COPY app.py c8y_agent.py solution_utils.py logging_config.py /apama_work/

# Run the service, and the SDK builds of untrusted repository content, unprivileged
USER apama

# Set the default command
CMD ["gunicorn", "--bind", "0.0.0.0:80", "--workers", "2", "--threads", "4", "--timeout", "120", "app:app"]