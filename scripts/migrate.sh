#!/usr/bin/env bash
# One-shot VPS-to-VPS migration for HireOrbit AI.
#
# Bundles the database, the uploads directory, AND backend/.env into a single
# portable tarball you can scp to a new host and import in one command. The
# bundle carries the server-side secrets (JWT_SECRET, STORAGE_URL_SECRET,
# COOKIE_SECRET, API keys) so the new VPS comes up identical — existing signed
# file URLs and refresh tokens keep working.
#
# Usage:
#   bash scripts/migrate.sh export                       # build the bundle (old host)
#   bash scripts/migrate.sh import <bundle.tar.gz>       # dry — prints what it would do
#   bash scripts/migrate.sh import <bundle.tar.gz> --force   # actually restore (new host)
#
# Output of export:
#   ${MIGRATE_DIR:-~/migrate}/hireorbitai-migrate-<UTC-stamp>.tar.gz   (chmod 600)
#     └─ db.sql.gz  uploads.tar.gz  env  manifest.txt
#
# SECURITY: the bundle contains live secrets. Transfer it only over scp/SSH,
# never to shared/cloud storage, and `rm` it from both hosts after import.
#
# Required env (read from backend/.env if present):
#   DATABASE_URL    postgres://user:pass@host:port/dbname
#   UPLOADS_DIR     absolute path to the uploads root (default: /var/lib/hireorbitai/uploads)
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/backend/.env"

load_env() {
  if [[ -f "$ENV_FILE" ]]; then
    # shellcheck disable=SC1090
    set -a; source "$ENV_FILE"; set +a
  fi
}

CMD="${1:-}"

case "$CMD" in
  # ─────────────────────────────────────────────────────────────── export ──
  export)
    load_env
    : "${DATABASE_URL:?DATABASE_URL not set (define it in backend/.env)}"
    UPLOADS_DIR="${UPLOADS_DIR:-/var/lib/hireorbitai/uploads}"

    if [[ ! -f "$ENV_FILE" ]]; then
      echo "✗ $ENV_FILE not found — a migration bundle must include it." >&2
      exit 1
    fi

    STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
    MIGRATE_DIR="${MIGRATE_DIR:-$HOME/migrate}"
    STAGE="$(mktemp -d)"
    trap 'rm -rf "$STAGE"' EXIT
    mkdir -p "$MIGRATE_DIR"
    BUNDLE="$MIGRATE_DIR/hireorbitai-migrate-$STAMP.tar.gz"

    echo "→ stamp:  $STAMP"
    echo "→ bundle: $BUNDLE"

    echo "→ pg_dump → db.sql.gz"
    pg_dump --no-owner --no-privileges "$DATABASE_URL" | gzip -9 > "$STAGE/db.sql.gz"
    echo "  ✓ $(stat -c%s "$STAGE/db.sql.gz" 2>/dev/null || wc -c < "$STAGE/db.sql.gz") bytes"

    if [[ -d "$UPLOADS_DIR" ]]; then
      echo "→ tar uploads → uploads.tar.gz"
      tar -czf "$STAGE/uploads.tar.gz" -C "$(dirname "$UPLOADS_DIR")" "$(basename "$UPLOADS_DIR")"
      echo "  ✓ $(stat -c%s "$STAGE/uploads.tar.gz" 2>/dev/null || wc -c < "$STAGE/uploads.tar.gz") bytes"
    else
      echo "  (UPLOADS_DIR $UPLOADS_DIR does not exist — bundling an empty uploads marker)"
      : > "$STAGE/uploads.tar.gz"  # zero-byte sentinel; import treats this as "no uploads"
    fi

    echo "→ copying backend/.env → env (secrets!)"
    cp "$ENV_FILE" "$STAGE/env"

    {
      echo "stamp:        $STAMP"
      echo "host:         $(hostname -f 2>/dev/null || hostname)"
      echo "git_sha:      $(cd "$ROOT" && git rev-parse --short HEAD 2>/dev/null || echo unknown)"
      echo "database_url: ${DATABASE_URL%%@*}@…"   # redact password
      echo "uploads_dir:  $UPLOADS_DIR"
      echo "contains_env: yes (DB url + JWT/STORAGE/COOKIE secrets + API keys)"
    } > "$STAGE/manifest.txt"

    tar -czf "$BUNDLE" -C "$STAGE" db.sql.gz uploads.tar.gz env manifest.txt
    chmod 600 "$BUNDLE"

    echo
    echo "✓ migration bundle ready: $BUNDLE"
    echo "  size: $(stat -c%s "$BUNDLE" 2>/dev/null || wc -c < "$BUNDLE") bytes (mode 600)"
    echo
    echo "Next — copy it to the new host over SSH, then import there:"
    echo "  scp \"$BUNDLE\" user@NEW_HOST:~/"
    echo "  # on NEW_HOST, after cloning the repo:"
    echo "  bash scripts/migrate.sh import ~/$(basename "$BUNDLE") --force"
    echo
    echo "⚠ This bundle holds live secrets. Delete it from BOTH hosts once the"
    echo "  new VPS is verified:  rm \"$BUNDLE\""
    ;;

  # ─────────────────────────────────────────────────────────────── import ──
  import)
    BUNDLE="${2:-}"
    FORCE="${3:-}"

    if [[ -z "$BUNDLE" ]]; then
      echo "usage: $0 import <bundle.tar.gz> [--force]" >&2
      exit 1
    fi
    if [[ ! -f "$BUNDLE" ]]; then
      echo "✗ bundle not found: $BUNDLE" >&2
      exit 1
    fi

    STAGE="$(mktemp -d)"
    trap 'rm -rf "$STAGE"' EXIT
    tar -xzf "$BUNDLE" -C "$STAGE"

    if [[ ! -f "$STAGE/env" || ! -f "$STAGE/db.sql.gz" ]]; then
      echo "✗ bundle is missing env or db.sql.gz — not a migrate bundle." >&2
      exit 1
    fi

    echo "── bundle manifest ──────────────────────────────────────"
    cat "$STAGE/manifest.txt" 2>/dev/null || echo "(no manifest)"
    echo "─────────────────────────────────────────────────────────"

    if [[ "$FORCE" != "--force" ]]; then
      echo
      echo "Dry run. Importing with --force will, on THIS host:"
      echo "  1. write backend/.env from the bundle (current .env backed up aside)"
      echo "  2. restore the database into the bundled DATABASE_URL (psql)"
      echo "  3. replace the uploads directory (current one moved aside)"
      echo
      echo "Re-run as: bash $0 import \"$BUNDLE\" --force"
      exit 2
    fi

    # 1. Install the bundled .env (back up any existing one first).
    if [[ -f "$ENV_FILE" ]]; then
      BK="$ENV_FILE.pre-migrate.$(date -u +%s)"
      echo "→ backing up existing backend/.env → $BK"
      cp "$ENV_FILE" "$BK"
    fi
    mkdir -p "$(dirname "$ENV_FILE")"
    cp "$STAGE/env" "$ENV_FILE"
    chmod 600 "$ENV_FILE"
    echo "→ wrote backend/.env from bundle"

    # Re-source so DATABASE_URL / UPLOADS_DIR reflect the migrated config.
    load_env
    : "${DATABASE_URL:?DATABASE_URL missing from bundled .env}"
    UPLOADS_DIR="${UPLOADS_DIR:-/var/lib/hireorbitai/uploads}"

    # 2. Restore the database.
    echo "→ restoring database from db.sql.gz → ${DATABASE_URL%%@*}@…"
    gunzip -c "$STAGE/db.sql.gz" | psql "$DATABASE_URL"
    echo "  ✓ db restored"

    # 3. Restore uploads (move the live dir aside first, like restore.sh).
    if [[ -s "$STAGE/uploads.tar.gz" ]]; then
      echo "→ restoring uploads → $UPLOADS_DIR"
      parent="$(dirname "$UPLOADS_DIR")"
      mkdir -p "$parent"
      if [[ -d "$UPLOADS_DIR" ]]; then
        mv "$UPLOADS_DIR" "${UPLOADS_DIR}.pre-migrate.$(date -u +%s)"
      fi
      tar -xzf "$STAGE/uploads.tar.gz" -C "$parent"
      echo "  ✓ uploads restored"
    else
      echo "  (bundle had no uploads — skipping)"
    fi

    echo
    echo "✓ import complete. Finish bringing the new host up:"
    echo "  npm ci                                   # repo root (all workspaces)"
    echo "  npm run build                            # shared + backend + frontend"
    echo "  npm --prefix backend run migrate:up      # apply any newer migrations"
    echo "  pm2 start backend/ecosystem.config.cjs   # or: pm2 reload hireorbit-api --update-env"
    echo "  curl -fsS http://127.0.0.1:\${PORT:-4000}/api/health   # verify"
    echo
    echo "⚠ Delete the migration bundle now — it holds secrets:  rm \"$BUNDLE\""
    ;;

  # ───────────────────────────────────────────────────────────────── help ──
  *)
    echo "usage: $0 <export|import> [args]" >&2
    echo "  $0 export                          build a portable migration bundle" >&2
    echo "  $0 import <bundle.tar.gz>          preview an import (dry run)" >&2
    echo "  $0 import <bundle.tar.gz> --force  restore db + uploads + .env on this host" >&2
    exit 1
    ;;
esac
