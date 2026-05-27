#!/usr/bin/env bash
# Restore a HireOrbit AI snapshot taken by scripts/backup.sh.
#
# Usage:
#   bash scripts/restore.sh <stamp>          # both db + uploads
#   bash scripts/restore.sh <stamp> db       # db only
#   bash scripts/restore.sh <stamp> uploads  # uploads only
#
# Refuses to run without an explicit `--force` argument so a fat-fingered
# `restore.sh` doesn't nuke production by accident.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/backend/.env"

# shellcheck source=scripts/lib-env.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib-env.sh"
load_env

: "${DATABASE_URL:?DATABASE_URL not set (define it in backend/.env)}"
UPLOADS_DIR="${UPLOADS_DIR:-/var/lib/hireorbitai/uploads}"

STAMP="${1:-}"
TARGET="${2:-all}"
FORCE="${3:-}"

if [[ -z "$STAMP" ]]; then
  echo "usage: $0 <stamp> [all|db|uploads] [--force]" >&2
  echo "       (available stamps under ${BACKUPS_DIR:-$HOME/backups})" >&2
  ls -1 "${BACKUPS_DIR:-$HOME/backups}" 2>/dev/null | tail -10 >&2 || true
  exit 1
fi

SRC="${BACKUPS_DIR:-$HOME/backups}/$STAMP"
if [[ ! -d "$SRC" ]]; then
  echo "✗ backup directory not found: $SRC" >&2
  exit 1
fi

if [[ "$FORCE" != "--force" ]]; then
  echo "Refusing to restore without --force."
  echo "This will OVERWRITE:"
  [[ "$TARGET" == "all" || "$TARGET" == "db" ]]       && echo "  - database at ${DATABASE_URL%%@*}@…"
  [[ "$TARGET" == "all" || "$TARGET" == "uploads" ]]  && echo "  - uploads at $UPLOADS_DIR"
  echo
  echo "Re-run as: bash $0 $STAMP $TARGET --force"
  exit 2
fi

if [[ "$TARGET" == "all" || "$TARGET" == "db" ]]; then
  if [[ ! -f "$SRC/db.sql.gz" ]]; then
    echo "✗ $SRC/db.sql.gz missing" >&2; exit 1
  fi
  echo "→ restoring database from $SRC/db.sql.gz"
  # We restore into the existing database; the dump uses CREATE … IF NOT EXISTS
  # patterns + ON CONFLICT, but a manual DROP/CREATE may be required if the
  # current schema has drifted incompatibly. In that case:
  #   psql "$DATABASE_URL" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
  gunzip -c "$SRC/db.sql.gz" | psql "$DATABASE_URL"
  echo "  ✓ db restored"
fi

if [[ "$TARGET" == "all" || "$TARGET" == "uploads" ]]; then
  if [[ ! -f "$SRC/uploads.tar.gz" ]]; then
    echo "  (no uploads.tar.gz in $SRC — skipping)"
  else
    echo "→ restoring uploads to $UPLOADS_DIR"
    parent="$(dirname "$UPLOADS_DIR")"
    mkdir -p "$parent"
    # Untar replacing the target directory atomically-ish — move the old one
    # aside first so we can roll back manually if the extracted tree is bad.
    if [[ -d "$UPLOADS_DIR" ]]; then
      mv "$UPLOADS_DIR" "${UPLOADS_DIR}.pre-restore.$(date -u +%s)"
    fi
    tar -xzf "$SRC/uploads.tar.gz" -C "$parent"
    echo "  ✓ uploads restored"
  fi
fi

echo "✓ restore from $STAMP complete"
echo "  Remember to: pm2 restart hireorbit-api --update-env"
