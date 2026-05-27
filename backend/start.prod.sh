#!/bin/sh
# Production startup wrapper for PM2.
#
# Use Node 22's built-in --env-file parser rather than `. .env`. Sourcing makes
# the shell EXECUTE each value, so a secret containing a space / '!' / '#' / '('
# (all valid for --env-file) breaks the launcher and silently drops or truncates
# that variable. --env-file parses KEY=VALUE without executing anything.
exec node --env-file="$(dirname "$0")/.env" "$(dirname "$0")/dist/server.js"
