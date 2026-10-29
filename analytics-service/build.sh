#!/bin/sh

# Copyright (c) 2025 Cumulocity GmbH
#
# SPDX-License-Identifier: Apache-2.0
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#
# @authors Christof Strack

# Build the analytics-ext-service microservice archive that can be uploaded in
# Administration > Ecosystem > Microservices.
#
# USAGE
#   ./build.sh [-h|--help]
#   ./build.sh [--push] <version> [<platform>] [<archive-name>]
#
# OPTIONS
#   --push         After the build, upload the archive to the tenant of the active go-c8y-cli
#                  session (needs c8y, and a session set with "set-session"). It creates the
#                  microservice if it does not exist yet, otherwise it uploads a new version.
#                  Without --push, nothing leaves your machine.
#
# ARGUMENTS
#   version        Version written into cumulocity.json ("{VERSION}-SNAPSHOT" is the template). Required.
#   platform       Docker target platform for the image. Default: linux/amd64
#   archive-name   Base name of the resulting zip. Default: analytics-ext-service
#
# EXAMPLES
#   ./build.sh 1.0.0                        # -> dist/analytics-ext-service.zip
#   ./build.sh 1.0.0 linux/arm64            # build the image for arm64
#   ./build.sh 1.0.0 linux/amd64 my-name    # -> dist/my-name.zip
#   ./build.sh --push 1.0.0-SNAPSHOT        # build, then upload to the active tenant
#
# WHAT IT DOES
#   1. Recreates ./build and ./dist (existing content is deleted).
#   2. Copies app.py, c8y_agent.py, solution_utils.py, logging_config.py and
#      requirements.txt to ./build and renders cumulocity.json and the Dockerfile.
#   3. If ./cumulocity-analytics-ext-service.json exists, merges it into
#      cumulocity.json (needs jq; keys of the extension file win).
#   4. Builds the Docker image (docker buildx), saves it to dist/image.tar and zips
#      it together with cumulocity.json into dist/<archive-name>.zip (needs zip).
#   5. With --push: uploads dist/<archive-name>.zip. A missing microservice is created with
#      "c8y microservices create"; an existing one gets a new version with
#      "c8y microservices createBinary".
#
# REQUIREMENTS
#   docker with buildx, zip, jq (only for the optional manifest extension), and
#   c8y (only for --push).
#   Run it from the analytics-service directory.
#
# EXIT CODES
#   0 success, 2 invalid arguments, any other non-zero value: a build step failed.

usage() {
  # print the documentation block above (from "Build the" to the line before the blank line after REQUIREMENTS)
  sed -n '/^# Build the analytics-ext-service/,/^#   0 success/p' "$0" | sed -e 's/^# \{0,1\}//'
}

# Take --push out of the arguments, wherever it appears, so the positional
# arguments below keep their meaning.
PUSH=0
for arg in "$@"; do
  shift
  case "$arg" in
    --push) PUSH=1 ;;
    *) set -- "$@" "$arg" ;;
  esac
done

case "$1" in
  -h|--help)
    usage
    exit 0
    ;;
  -*)
    echo "Unknown option: $1" >&2
    echo >&2
    usage >&2
    exit 2
    ;;
  "")
    echo "Missing <version>." >&2
    echo >&2
    usage >&2
    exit 2
    ;;
esac

# Fail before the build, not after it, if the upload cannot work.
if [ "$PUSH" = 1 ] && ! command -v c8y >/dev/null 2>&1; then
  echo "--push needs the go-c8y-cli command 'c8y' on the PATH." >&2
  exit 2
fi

# Stop at the first failing command (docker build, docker save, zip, c8y) instead of
# printing "Created uploadable archive" for a broken result.
set -e

NAME="analytics-ext-service"
VERSION="$1"
IMG_ARCH="$2"
IMG_NAME="$3"
if ! [ $IMG_NAME ]; then
  IMG_NAME=$(echo "$NAME" | tr '[:upper:]' '[:lower:]' | tr '[:punct:]' '-')
fi

if ! [ $IMG_ARCH ]; then
  ARCH="linux/amd64"
else
  ARCH="$IMG_ARCH"
fi
BUILD_DIR="./build"
DIST_DIR="./dist"
TARGET="$DIST_DIR/$IMG_NAME.zip"

echo "Name: $NAME, Image Name: $IMG_NAME, Version: $VERSION", Arch: "$ARCH"
echo "Build directory: $BUILD_DIR"
echo "Dist directory:  $DIST_DIR"
echo "Target location: $TARGET"
echo ""

# prepare directories
[ -d "$BUILD_DIR" ] && rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"
[ -d "$DIST_DIR" ] && rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"

# copy & render sources
cp ./requirements.txt "$BUILD_DIR"
cp ./app.py "$BUILD_DIR"
cp ./solution_utils.py "$BUILD_DIR"
cp ./c8y_agent.py "$BUILD_DIR"
cp ./logging_config.py "$BUILD_DIR"
sed -e "s/{VERSION}/$VERSION/g" ./cumulocity.json > "$BUILD_DIR/cumulocity.json"
sed -e "s/{SAMPLE}/$NAME/g" ./Dockerfile > "$BUILD_DIR/Dockerfile"
# extend cumulocity.json is defined
if [ -r ./cumulocity-$NAME.json ]; then
  echo -n "Found custom extension at './cumulocity-$NAME.json'. Applying ..."
  tmp=$(mktemp)
  jq -s '.[0] + .[1]' "$BUILD_DIR/cumulocity.json" ./cumulocity-$NAME.json > $tmp
  mv $tmp "$BUILD_DIR/cumulocity.json"
  echo "  Done."
fi

# build image
echo "Building image ..."
# docker buildx create --use --name multi-builder --platform linux/amd64 -t "$NAME" "$BUILD_DIR"
docker buildx build --platform $ARCH --load -t "$NAME" "$BUILD_DIR"

docker save -o "$DIST_DIR/image.tar" "$NAME"
zip -j "$DIST_DIR/$IMG_NAME.zip" "$BUILD_DIR/cumulocity.json" "$DIST_DIR/image.tar"

echo ""
echo "Created uploadable archive: $TARGET"

if [ "$PUSH" = 1 ]; then
  echo ""
  echo "Uploading $TARGET to the active c8y session ..."
  if [ -n "$(c8y microservices list --name "$NAME" --select id --output csv)" ]; then
    echo "Microservice $NAME exists, uploading a new version ..."
    c8y microservices list --name "$NAME" | c8y microservices createBinary --file "$TARGET" --timeout 360
  else
    echo "Microservice $NAME does not exist, creating it ..."
    c8y microservices create --file "$TARGET" --name "$NAME" --timeout 360
  fi
  echo "Uploaded $TARGET"
fi