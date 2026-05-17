#!/usr/bin/env bash
# Production redeploy for HireOrbit AI on Hostinger VPS + CloudPanel.
#
# Pulls the latest commit, rebuilds whatever changed, runs any new SQL
# migrations, restarts the API, republishes the frontend bundle, and curls
# /api/health to confirm the process came back up. Bails on the first
# failure so a broken deploy doesn't silently take production offline.
#
# Run as the CloudPanel site user (typically `hireorbitai`).
#
#   bash scripts/update.sh           # both halves + migrations
#   bash scripts/update.sh backend   # backend + migrations only
#   bash scripts/update.sh frontend  # frontend only
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEBROOT="${WEBROOT:-$HOME/htdocs/hireorbitai.com}"
PM2_NAME="${PM2_NAME:-hireorbitai-api}"
SMOKE_URL="${SMOKE_URL:-https://hireorbitai.com/api/health}"
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
  # IMPORTANT: install at the workspace ROOT, not inside backend/. This is an
  # npm workspaces monorepo (root package.json declares workspaces: shared,
  # backend, frontend). `cd backend && npm ci` would not symlink the
  # @hireorbitai/shared workspace package and the build would fail with
  # "Cannot find module '@hireorbitai/shared'".
  echo "→ install workspace dependencies (root)"
  npm install --no-audit --no-fund

  echo "→ build shared package"
  npm run shared:build

  echo "→ backend: build"
  npm --prefix backend run build

  # Apply any pending SQL migrations. The baseline (1700000000000_baseline.sql)
  # is a no-op sentinel claiming the existing database/*.sql tree as version 0.
  # Subsequent migrations under backend/migrations/ run forward each deploy.
  echo "→ backend: apply migrations"
  npm --prefix backend run migrate:up

  echo "→ backend: pm2 restart $PM2_NAME"
  pm2 restart "$PM2_NAME" --update-env
fi

if [[ "$TARGET" == "all" || "$TARGET" == "frontend" ]]; then
  echo "→ frontend: build (deps already installed at root)"
  npm --prefix frontend run build
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
