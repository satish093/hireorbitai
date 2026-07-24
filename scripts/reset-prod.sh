#!/usr/bin/env bash
# =============================================================================
# MODE 2 — FULL PRODUCTION RESET.  *** DESTRUCTIVE ***
#
# Erases ALL production data (database + uploads) and rebuilds a clean schema.
# This is NOT wired into any CI/CD and must be run by a human, on the VPS, on
# purpose. There is no undo except the backup this script takes first.
#
# It exists so a "fresh deployment / wipe the old app data" is a documented,
# gated, recoverable operation — not an improvised `DROP DATABASE`.
#
# ALL of the following gates must pass or the script refuses:
#   1. env CONFIRM == the literal string  ERASE-PRODUCTION
#   2. first argument == --i-understand
#   3. DATABASE_URL must contain 'hireorbit_prod'  (proves you mean prod)
#   4. a full backup (scripts/backup.sh) succeeds BEFORE anything is dropped
#
# Usage (on the VPS, as the CloudPanel site user):
#   set -a; source ~/hireorbitai/backend/.env; set +a   # not strictly needed; script sources it
#   CONFIRM=ERASE-PRODUCTION bash scripts/reset-prod.sh --i-understand
#
# Optional:
#   SEED_ADMIN=true   also run `npm run bootstrap:admin` after the rebuild
#
# Rollback: restore the backup this script just took —
#   bash scripts/restore.sh <stamp-printed-below> all --force
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/backend/.env"
PM2_NAME="${PM2_NAME:-hireorbitai-api}"
SMOKE_URL="${SMOKE_URL:-https://hireorbitai.com/api/health}"

# ---- Gate 1 + 2 -------------------------------------------------------------
if [[ "${1:-}" != "--i-understand" ]]; then
  echo "✗ Refusing: pass --i-understand as the first argument." >&2
  echo "  Usage: CONFIRM=ERASE-PRODUCTION bash scripts/reset-prod.sh --i-understand" >&2
  exit 2
fi
if [[ "${CONFIRM:-}" != "ERASE-PRODUCTION" ]]; then
  echo "✗ Refusing: set CONFIRM=ERASE-PRODUCTION in the environment." >&2
  exit 2
fi

# shellcheck source=scripts/lib-env.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib-env.sh"
load_env
: "${DATABASE_URL:?DATABASE_URL not set (and backend/.env did not define it)}"
UPLOADS_DIR="${UPLOADS_DIR:-/var/lib/hireorbitai/uploads}"

# ---- Gate 3 -----------------------------------------------------------------
case "$DATABASE_URL" in
  *hireorbit_prod*) : ;;
  *)
    echo "✗ Refusing: DATABASE_URL does not contain 'hireorbit_prod'." >&2
    echo "  This script ONLY resets production. Target: ${DATABASE_URL%%@*}@…" >&2
    exit 2 ;;
esac

echo "================================================================"
echo "  FULL PRODUCTION RESET"
echo "  database: ${DATABASE_URL%%@*}@…"
echo "  uploads:  $UPLOADS_DIR"
echo "================================================================"

# Final interactive tripwire — type the database name to proceed.
DBNAME="${DATABASE_URL##*/}"; DBNAME="${DBNAME%%\?*}"
read -r -p "Type the database name ($DBNAME) to ERASE it: " typed
if [[ "$typed" != "$DBNAME" ]]; then
  echo "✗ Name mismatch — aborting. Nothing was changed."
  exit 2
fi

# ---- Gate 4: backup BEFORE any destruction ----------------------------------
STAMP=""
if [[ "${SKIP_BACKUP:-false}" == "true" ]]; then
  echo "⚠  SKIP_BACKUP=true — skipping backup. There is NO rollback if this goes wrong."
else
  echo "→ taking a full backup first (db + uploads)…"
  bash "$ROOT/scripts/backup.sh"
  STAMP_DIR="$(ls -1dt "${BACKUPS_DIR:-$HOME/backups}"/*/ 2>/dev/null | head -1 || true)"
  STAMP_DIR="${STAMP_DIR%/}"
  # Fail CLOSED: never DROP unless a non-empty DB dump is verifiably on disk.
  if [[ -z "$STAMP_DIR" || ! -s "$STAMP_DIR/db.sql.gz" ]]; then
    echo "✗ Refusing to proceed: no verified DB backup found after backup.sh." >&2
    echo "  Expected a non-empty db.sql.gz under ${BACKUPS_DIR:-$HOME/backups}/<stamp>/." >&2
    exit 1
  fi
  STAMP="$(basename "$STAMP_DIR")"
  echo "  ✓ verified backup: $STAMP_DIR"
  echo "    (rollback later with: bash scripts/restore.sh $STAMP all --force)"
fi

# ---- Wipe + rebuild ---------------------------------------------------------
echo "→ DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"

echo "→ loading database/init.sql"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$ROOT/database/init.sql"

echo "→ applying incremental migrations"
npm --prefix "$ROOT/backend" run migrate:up

# ---- Uploads: move the old tree aside (recoverable), then recreate empty -----
if [[ -d "$UPLOADS_DIR" ]]; then
  aside="${UPLOADS_DIR}.pre-reset.$(date -u +%Y%m%dT%H%M%SZ)"
  echo "→ moving old uploads to $aside"
  mv "$UPLOADS_DIR" "$aside"
fi
mkdir -p "$UPLOADS_DIR"

# ---- Optional fresh admin ---------------------------------------------------
if [[ "${SEED_ADMIN:-false}" == "true" ]]; then
  echo "→ bootstrapping a fresh SUPER_ADMIN"
  npm --prefix "$ROOT/backend" run bootstrap:admin
fi

# ---- Restart + verify -------------------------------------------------------
echo "→ pm2 restart $PM2_NAME"
pm2 restart "$PM2_NAME" --update-env

echo "→ smoke test: $SMOKE_URL"
code=$(curl -sS -o /tmp/reset_health.body -w "%{http_code}" "$SMOKE_URL" || echo "000")
if [[ "$code" != "200" ]]; then
  echo "✗ smoke test failed — HTTP $code"
  cat /tmp/reset_health.body || true
  echo "  ROLLBACK: bash scripts/restore.sh $STAMP all --force && pm2 restart $PM2_NAME --update-env"
  exit 1
fi

echo "  ✓ HTTP 200 — $(cat /tmp/reset_health.body)"
echo "✓ production reset complete."
echo "  Old uploads preserved alongside $UPLOADS_DIR (delete once verified)."
if [[ -n "$STAMP" ]]; then
  echo "  Backup for rollback: $STAMP"
fi
