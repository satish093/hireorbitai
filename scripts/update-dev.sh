#!/usr/bin/env bash
# Dev-environment redeploy for HireOrbit AI (dev branch → dev.yourdomain.com).
#
# Identical logic to scripts/update.sh but defaults to the dev PM2 process,
# dev webroot, dev smoke URL, and pulls from the `dev` branch.
#
# Run as the CloudPanel site user on the VPS:
#
#   bash scripts/update-dev.sh           # backend + frontend + migrations
#   bash scripts/update-dev.sh backend   # backend + migrations only
#   bash scripts/update-dev.sh frontend  # frontend only
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEBROOT="${WEBROOT:-$HOME/htdocs/dev.hireorbitai.com}"
PM2_NAME="${PM2_NAME:-hireorbitai-dev}"
SMOKE_URL="${SMOKE_URL:-https://dev.hireorbitai.com/api/health}"
TARGET="${1:-all}"

# Dev runs from a separate directory (~/hireorbitai-dev) so the dev and prod
# worktrees never conflict. If you cloned prod to ~/hireorbitai, clone dev to
# ~/hireorbitai-dev and point this script there instead.
DEV_ROOT="${DEV_ROOT:-$ROOT}"

cd "$DEV_ROOT"

before_sha="$(git rev-parse --short HEAD)"

# Reset any tracked-file changes left by the previous deploy (npm can rewrite
# package-lock.json, which would block git pull).
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "→ resetting tracked-file changes from previous deploy"
  git checkout -- .
fi

echo "→ git fetch && pull (ff-only) — dev branch"
git fetch --tags --prune
git pull --ff-only

after_sha="$(git rev-parse --short HEAD)"
if [[ "$before_sha" == "$after_sha" ]]; then
  echo "  (already at $after_sha — nothing pulled)"
else
  echo "  $before_sha → $after_sha"
fi

if [[ "$TARGET" == "all" || "$TARGET" == "backend" ]]; then
  echo "→ install workspace dependencies (root)"
  npm install --no-audit --no-fund

  echo "→ build shared package"
  npm run shared:build

  echo "→ backend: build"
  npm --prefix backend run build

  echo "→ backend: apply migrations (dev database)"
  npm --prefix backend run migrate:up

  echo "→ backend: pm2 restart $PM2_NAME"
  pm2 restart "$PM2_NAME" --update-env
fi

if [[ "$TARGET" == "all" || "$TARGET" == "frontend" ]]; then
  echo "→ frontend: build"
  npm --prefix frontend run build
  if [[ ! -d "$WEBROOT" ]]; then
    echo "✗ webroot $WEBROOT does not exist — set WEBROOT env var" >&2
    exit 1
  fi
  echo "→ frontend: publish to $WEBROOT"
  rsync -a --delete "$DEV_ROOT/frontend/dist/" "$WEBROOT/"
fi

echo "→ smoke test: $SMOKE_URL"
code=$(curl -sS -o /tmp/healthz-dev.body -w "%{http_code}" "$SMOKE_URL" || echo "000")
if [[ "$code" != "200" ]]; then
  echo "✗ smoke test failed — got HTTP $code"
  cat /tmp/healthz-dev.body || true
  echo "  pm2 logs $PM2_NAME --lines 100   # to investigate"
  exit 1
fi
echo "  ✓ HTTP 200 — $(cat /tmp/healthz-dev.body)"

echo "✓ dev deploy complete ($before_sha → $after_sha)"
