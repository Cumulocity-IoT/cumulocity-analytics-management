# Builds an Analytics Builder extension zip from a directory of .mon files
# (and, for repository/connectivity-bundle, a config/connectivity/*.yaml) —
# the same tool and base image analytics-service/Dockerfile already uses to
# do this, just without the Flask app around it, for local/manual builds of
# the extensions under repository/ in this repo.
#
# Build once:
#   docker build -t apama-extension-builder repository/builder
#
# Then build any extension folder under repository/ into a zip:
#   docker run --rm \
#     -v "$(pwd)/repository/connectivity-bundle:/input:ro" \
#     -v "$(pwd)/dist:/output" \
#     apama-extension-builder --input /input --output /output/connectivity-bundle.zip
#
# Swap the -v source for repository/epl, repository/blocks, etc. for other
# extensions. Verified working (see docs/features/block-marketplace/
# DIRECT_UPLOAD.md) against repository/connectivity-bundle on 2026-07-17,
# built on Apple Silicon via Docker's linux/amd64 emulation (the upstream
# image is amd64-only) — if you're on amd64 already, drop --platform.

FROM --platform=linux/amd64 public.ecr.aws/apama/apama-builder:latest

WORKDIR /apama_work

USER root

RUN (command -v dnf && dnf install -y git && dnf clean all) || \
    (command -v yum && yum install -y git && yum clean all) || \
    (command -v apt-get && apt-get update && apt-get install -y git && apt-get clean) || \
    (command -v apk && apk add --no-cache git)

RUN git clone --depth 1 https://github.com/Cumulocity-IoT/apama-analytics-builder-block-sdk.git

ENTRYPOINT ["/apama_work/apama-analytics-builder-block-sdk/analytics_builder", "build", "extension"]
