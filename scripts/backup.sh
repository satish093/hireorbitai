#!/usr/bin/env bash
# Snapshot the HireOrbit AI database + uploads directory.
#
# Output: ~/backups/<UTC-stamp>/{db.sql.gz, uploads.tar.gz, manifest.txt}
#
# Idempotent — re-running creates a new stamped directory each time. No
# retention policy here; layer your own cron to prune old stamps (see
# docs/deployment/production.md).
#
# Required env (the script reads from backend/.env if present):
#   DATABASE_URL    postgres://user:pass@host:port/dbname
#   UPLOADS_DIR     absolute path to the uploads root (default: /var/lib/hireorbitai/uploads)
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/backend/.env"

# shellcheck source=scripts/lib-env.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib-env.sh"
load_env

: "${DATABASE_URL:?DATABASE_URL not set (define it in backend/.env)}"
UPLOADS_DIR="${UPLOADS_DIR:-/var/lib/hireorbitai/uploads}"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="${BACKUPS_DIR:-$HOME/backups}/$STAMP"
mkdir -p "$DEST"

echo "→ stamp:   $STAMP"
echo "→ dest:    $DEST"

echo "→ pg_dump → db.sql.gz"
pg_dump --no-owner --no-privileges "$DATABASE_URL" | gzip -9 > "$DEST/db.sql.gz"
db_bytes=$(stat -c%s "$DEST/db.sql.gz" 2>/dev/null || wc -c < "$DEST/db.sql.gz")
echo "  ✓ ${db_bytes} bytes"

if [[ -d "$UPLOADS_DIR" ]]; then
  echo "→ tar uploads → uploads.tar.gz"
  tar -czf "$DEST/uploads.tar.gz" -C "$(dirname "$UPLOADS_DIR")" "$(basename "$UPLOADS_DIR")"
  up_bytes=$(stat -c%s "$DEST/uploads.tar.gz" 2>/dev/null || wc -c < "$DEST/uploads.tar.gz")
  echo "  ✓ ${up_bytes} bytes"
else
  echo "  (UPLOADS_DIR $UPLOADS_DIR doesn't exist — skipping uploads)"
fi

{
  echo "stamp:        $STAMP"
  echo "host:         $(hostname -f 2>/dev/null || hostname)"
  echo "git_sha:      $(cd "$ROOT" && git rev-parse --short HEAD 2>/dev/null || echo unknown)"
  echo "database_url: ${DATABASE_URL%%@*}@…"   # redact password
  echo "uploads_dir:  $UPLOADS_DIR"
} > "$DEST/manifest.txt"

echo "✓ backup complete: $DEST"
