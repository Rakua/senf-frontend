#!/bin/bash
cd "$(dirname "$0")"

port="${1:-8080}"

echo "Start webserver (no auto-build)"
#npx http-server dist -S -s &
npx http-server dist -S -p "$port" &    # shows URL of server
