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

# Reset any tracked-file changes the previous deploy may have left behind.
# npm install on the VPS occasionally rewrites package-lock.json (different
# OS / npm version vs. CI), which blocks the next `git pull --ff-only` with
# "Your local changes would be overwritten by merge". The deploy target has
# no business holding manual edits — discard them. Untracked files (.env,
# uploads, etc.) are NOT touched.
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "→ resetting tracked-file changes from previous deploy"
  git checkout -- .
fi

# Untracked migration / SQL files would also block `git pull --ff-only` if
# the same path lands in the next commit (which is exactly what happens
# when a migration file is created on the VPS during a previous failed
# deploy attempt — node-pg-migrate's create-migration step writes the
# file before the SQL inside is finalised). These directories should
# only ever contain repo-tracked content, so it's safe to nuke any
# untracked stragglers. `.env` and other secrets live outside these
# paths and are NOT touched.
for protected in backend/migrations database; do
  if [[ -d "$protected" ]]; then
    untracked=$(git ls-files --others --exclude-standard -- "$protected" || true)
    if [[ -n "$untracked" ]]; then
      echo "→ removing untracked files under $protected/ (would block git pull):"
      echo "$untracked" | sed 's/^/    /'
      # -x in case .gitignore would have kept them; -d only removes empty dirs.
      git clean -fxd -- "$protected"
    fi
  fi
done

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

# Reconcile off-site backup config (rclone R2 remote + weekly cron) from the
# R2_* vars in backend/.env. Idempotent + non-interactive; best-effort so a
# backup-setup hiccup never fails a healthy deploy.
echo "→ reconcile backup config (ops ensure)"
bash "$ROOT/scripts/ops.sh" ensure || echo "  (ops ensure skipped/failed — non-fatal)"

echo "✓ deploy complete ($before_sha → $after_sha)"
