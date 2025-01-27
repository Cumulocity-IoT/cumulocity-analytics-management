# Use the base image
FROM public.ecr.aws/apama/apama-builder:10.15-ubi9 AS builder

# Set the working directory
WORKDIR /apama_work

USER root

# Combine all installation steps into a single layer and cleanup
# Combine all installation steps into a single layer and cleanup
RUN microdnf install -y gcc git tar openssl-devel bzip2-devel libffi-devel zlib-devel wget make && \
    mkdir -p /tmp/builder && \
    cd /tmp && \
    wget https://www.python.org/ftp/python/3.10.13/Python-3.10.13.tgz && \
    tar xzf Python-3.10.13.tgz && \
    cd Python-3.10.13 && \
    ./configure --enable-optimizations && \
    make altinstall && \
    cd .. && \
    rm -rf Python-3.10.13 Python-3.10.13.tgz && \
    microdnf remove -y gcc make wget && \
    microdnf clean all && \
    ln -sf /usr/local/bin/python3.10 /usr/bin/python3 && \
    ln -sf /usr/local/bin/pip3.10 /usr/bin/pip3

# Use multi-stage build to reduce final image size
FROM public.ecr.aws/apama/apama-builder:10.15-ubi9

WORKDIR /apama_work

# Switch to root user
USER root

# Copy Python installation from builder
COPY --from=builder /usr/local /usr/local
COPY --from=builder /usr/bin/python3 /usr/bin/python3
COPY --from=builder /usr/bin/pip3 /usr/bin/pip3

# Install runtime dependencies
RUN microdnf install -y git openssl-devel bzip2-devel libffi-devel zlib-devel && \
    microdnf clean all

# Clone SDK with minimal history
RUN git clone --depth 1 https://github.com/Cumulocity-IoT/apama-analytics-builder-block-sdk.git

# Install Python dependencies
COPY requirements.txt /apama_work/
# RUN pip3 install --no-cache-dir -r requirements.txt
RUN /usr/local/bin/pip3.10 install --no-cache-dir -r requirements.txt

# Copy application files
COPY flask_wrapper.py c8y_agent.py /apama_work/

# Set the default command
CMD ["/usr/local/bin/python3.10", "flask_wrapper.py"]