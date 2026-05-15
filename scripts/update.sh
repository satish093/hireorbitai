#!/usr/bin/env bash
# Production redeploy for HireOrbit AI on Hostinger VPS + CloudPanel.
#
# Pulls the latest commit, rebuilds whatever changed, restarts the API,
# republishes the frontend bundle, and curls /api/healthz to confirm the
# process came back up. Bails on the first failure so a broken deploy
# doesn't silently take production offline.
#
# Run as the CloudPanel site user (typically `hireorbitai`).
#
#   bash scripts/update.sh           # both halves
#   bash scripts/update.sh backend   # backend only
#   bash scripts/update.sh frontend  # frontend only
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEBROOT="${WEBROOT:-$HOME/htdocs/hireorbitai.com}"
PM2_NAME="${PM2_NAME:-hireorbit-api}"
SMOKE_URL="${SMOKE_URL:-https://hireorbitai.com/api/healthz}"
TARGET="${1:-all}"

cd "$ROOT"

before_sha="$(git rev-parse --short HEAD)"

echo "→ git fetch && pull (ff-only)"
git fetch --tags --prune
git pull --ff-only

after_sha="$(git rev-parse --short HEAD)"
if [[ "$before_sha" == "$after_sha" ]]; then
  echo "  (already at $after_sha — nothing pulled)"
else
  echo "  $before_sha → $after_sha"
fi

if [[ "$TARGET" == "all" || "$TARGET" == "backend" ]]; then
  echo "→ backend: install + build"
  ( cd "$ROOT/backend" && npm ci && npm run build )
  echo "→ backend: pm2 restart $PM2_NAME"
  pm2 restart "$PM2_NAME" --update-env
fi

if [[ "$TARGET" == "all" || "$TARGET" == "frontend" ]]; then
  echo "→ frontend: install + build"
  ( cd "$ROOT/frontend" && npm ci && npm run build )
  if [[ ! -d "$WEBROOT" ]]; then
    echo "✗ webroot $WEBROOT does not exist — set WEBROOT env var" >&2
    exit 1
  fi
  echo "→ frontend: publish to $WEBROOT"
  rsync -a --delete "$ROOT/frontend/dist/" "$WEBROOT/"
fi

echo "→ smoke test: $SMOKE_URL"
code=$(curl -sS -o /tmp/healthz.body -w "%{http_code}" "$SMOKE_URL" || echo "000")
if [[ "$code" != "200" ]]; then
  echo "✗ smoke test failed — got HTTP $code"
  cat /tmp/healthz.body || true
  echo "  pm2 logs $PM2_NAME --lines 100   # to investigate"
  exit 1
fi
echo "  ✓ HTTP 200 — $(cat /tmp/healthz.body)"

echo "✓ deploy complete ($before_sha → $after_sha)"
