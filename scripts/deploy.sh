#!/usr/bin/env bash
# DEPRECATED — superseded by scripts/update.sh (the canonical production deploy,
# invoked by .github/workflows/deploy-production.yml).
#
# This script's old body was unsafe and is no longer used:
#   - it restarted PM2 process "hireorbit-api" (the real name is "hireorbitai-api"),
#   - it ran `npm ci` inside backend/, which breaks the @hireorbitai/shared
#     workspace symlink (exactly what update.sh's comments warn against),
#   - it never ran database migrations or `shared:build`, and
#   - it lacked the `git checkout -- .` self-heal, so `git pull --ff-only`
#     would fail on a VPS where a previous npm run rewrote package-lock.json.
#
# update.sh does all of that correctly. To avoid two divergent deploy paths,
# this wrapper now just delegates to it. Partial backend/frontend-only deploys
# are intentionally not supported here — the canonical path always does both.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
echo "⚠ scripts/deploy.sh is deprecated — delegating to scripts/update.sh" >&2
exec bash "$ROOT/scripts/update.sh"
