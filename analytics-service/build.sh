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

NAME="$1"
VERSION="$2"
IMG_ARCH="$3"
IMG_NAME="$4"
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
cp ./flask_wrapper.py "$BUILD_DIR"
cp ./extension_builder.py "$BUILD_DIR"
cp ./monitor_downloader.py "$BUILD_DIR"
cp ./solution_utils.py "$BUILD_DIR"
cp ./c8y_agent.py "$BUILD_DIR"
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