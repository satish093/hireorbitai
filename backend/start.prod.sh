#!/bin/sh
# Production startup wrapper for PM2.
# Sources .env so all variables are in process.env before Node starts.
# This is more reliable than Node's --env-file flag inside PM2 node_args.
set -a
. "$(dirname "$0")/.env"
set +a
exec node "$(dirname "$0")/dist/server.js"
