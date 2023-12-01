#!/bin/sh
set-session
./build.sh analytics-ext-service 0.0.7-SNAPSHOT
c8y microservices list --name analytics-ext-service | c8y microservices createBinary --file dist/analytics-ext-service.zip --timeout 360