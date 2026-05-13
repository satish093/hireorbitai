#!/usr/bin/env bash
# Production redeploy for HireOrbit AI on Hostinger VPS + CloudPanel.
#
# Run as the CloudPanel site user (e.g. hireorbit). Assumes the layout from
# DEPLOY.md:
#   - repo lives at ~/talentbridgeai
#   - frontend webroot at /home/<user>/htdocs/hireorbitai.com
#   - backend is run under PM2 with name "hireorbit-api"
#
# Usage:
#   bash scripts/deploy.sh           # backend + frontend
#   bash scripts/deploy.sh backend   # backend only
#   bash scripts/deploy.sh frontend  # frontend only
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEBROOT="${WEBROOT:-$HOME/htdocs/hireorbitai.com}"
PM2_NAME="${PM2_NAME:-hireorbit-api}"
TARGET="${1:-all}"

cd "$ROOT"

echo "→ git pull"
git pull --ff-only

if [[ "$TARGET" == "all" || "$TARGET" == "backend" ]]; then
  echo "→ backend: install + build"
  cd "$ROOT/backend"
  npm ci
  npm run build
  echo "→ backend: pm2 restart $PM2_NAME"
  pm2 restart "$PM2_NAME" --update-env
  cd "$ROOT"
fi

if [[ "$TARGET" == "all" || "$TARGET" == "frontend" ]]; then
  echo "→ frontend: install + build"
  cd "$ROOT/frontend"
  npm ci
  npm run build
  echo "→ frontend: publish to $WEBROOT"
  if [[ ! -d "$WEBROOT" ]]; then
    echo "✗ webroot $WEBROOT does not exist — set WEBROOT env var" >&2
    exit 1
  fi
  # Atomic-ish swap: write into a sibling dir then rsync-delete.
  rsync -a --delete "$ROOT/frontend/dist/" "$WEBROOT/"
  cd "$ROOT"
fi

echo "✓ deploy complete"
echo "→ smoke test:"
curl -sS -o /dev/null -w "  /            %{http_code}\n" https://hireorbitai.com/ || true
curl -sS -o /dev/null -w "  /api/health  %{http_code}\n" https://hireorbitai.com/api/health || true
