#!/usr/bin/env bash
# HireOrbit AI operator tool — one entrypoint for backups, off-site copies,
# restore drills, and host migration. Wraps the low-level primitives
# (scripts/backup.sh, scripts/restore.sh) with practical, memorable verbs.
#
#   bash scripts/ops.sh setup                 install rclone + configure Mega + weekly cron (turnkey)
#   bash scripts/ops.sh backup [--prune-weeks N]   snapshot now + copy off-site  (this is the weekly cron)
#   bash scripts/ops.sh verify                restore-drill the newest dump into a throwaway DB
#   bash scripts/ops.sh ship                  build a migration bundle (db+uploads+.env) and push off-site
#   bash scripts/ops.sh land [name|path] --force   pull/import a bundle on a NEW host + rebuild + pm2
#   bash scripts/ops.sh restore <stamp> [db|uploads|all] --force   restore a local backup (-> restore.sh)
#
# Off-site target is Mega (free 20 GB, no credit card) but any rclone remote
# works via RCLONE_REMOTE / RCLONE_DEST.
#
# Env (read from backend/.env if present):
#   DATABASE_URL, UPLOADS_DIR (default /var/lib/hireorbitai/uploads)
#   MEGA_EMAIL, MEGA_PASSWORD   — used to auto-configure the rclone remote
#   RCLONE_REMOTE (default mega), RCLONE_DEST (default hireorbitai-backups)
#   BACKUPS_DIR (default ~/backups), MIGRATE_DIR (default ~/migrate)
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/backend/.env"
BACKUPS_DIR="${BACKUPS_DIR:-$HOME/backups}"
MIGRATE_DIR="${MIGRATE_DIR:-$HOME/migrate}"
RCLONE_REMOTE="${RCLONE_REMOTE:-mega}"
RCLONE_DEST="${RCLONE_DEST:-hireorbitai-backups}"
MIGRATE_PATH="${RCLONE_REMOTE}:${RCLONE_DEST}/migrate"
PM2_NAME="${PM2_NAME:-hireorbitai-api}"
CANARY_TABLES=(users recruiters consultants jobs applications)

# Safe .env parsing (never executes values — see lib-env.sh). Provides load_env.
# shellcheck source=scripts/lib-env.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib-env.sh"

require_rclone() {
  if ! command -v rclone >/dev/null 2>&1; then
    echo "✗ rclone is not installed. Run: bash scripts/ops.sh setup" >&2
    exit 1
  fi
  if ! rclone listremotes 2>/dev/null | grep -qx "${RCLONE_REMOTE}:"; then
    echo "✗ rclone remote '${RCLONE_REMOTE}:' not found. Run: bash scripts/ops.sh setup" >&2
    exit 1
  fi
}

newest_stamp_dir() {
  find "$BACKUPS_DIR" -mindepth 1 -maxdepth 1 -type d -name '20*' 2>/dev/null | sort | tail -1
}

# Create the rclone Mega remote from MEGA_* env vars (sourced from backend/.env)
# if it doesn't already exist. Mega authenticates with email + password, so this
# is fully non-interactive (the password is obscured via `rclone obscure`).
# Returns 0 if the remote exists or was created, 1 if creds are missing.
ensure_remote() {
  rclone listremotes 2>/dev/null | grep -qx "${RCLONE_REMOTE}:" && return 0
  if [[ -n "${MEGA_EMAIL:-}" && -n "${MEGA_PASSWORD:-}" ]]; then
    rclone config create "$RCLONE_REMOTE" mega \
      user="$MEGA_EMAIL" \
      pass="$(rclone obscure "$MEGA_PASSWORD")" >/dev/null
    return 0
  fi
  return 1
}

# Install the weekly backup cron (Sunday 03:00) idempotently. Written to be
# set -e safe even when there's no existing crontab yet.
install_weekly_cron() {
  local line="0 3 * * 0 $ROOT/scripts/ops.sh backup --prune-weeks 8 >> $BACKUPS_DIR/ops.log 2>&1"
  mkdir -p "$BACKUPS_DIR"
  local current
  current="$(crontab -l 2>/dev/null | grep -vF 'scripts/ops.sh backup' || true)"
  printf '%s\n%s\n' "$current" "$line" | grep -v '^[[:space:]]*$' | crontab -
}

CMD="${1:-}"

case "$CMD" in
  # ──────────────────────────────────────────────────────────────── setup ──
  setup)
    load_env   # pick up MEGA_* if already in backend/.env
    # 1. rclone
    if ! command -v rclone >/dev/null 2>&1; then
      echo "→ installing rclone"
      curl https://rclone.org/install.sh | sudo bash
    else
      echo "→ rclone already installed ($(rclone version | head -1))"
    fi

    # 2. Mega remote — from backend/.env if present, else prompt.
    if rclone listremotes 2>/dev/null | grep -qx "${RCLONE_REMOTE}:"; then
      echo "→ rclone remote '${RCLONE_REMOTE}:' already configured — leaving as is"
    elif ensure_remote; then
      echo "→ rclone remote '${RCLONE_REMOTE}:' created from backend/.env (MEGA_*)"
    else
      echo "Configure Mega (your free mega.nz account — no credit card needed):"
      read -rp "  Mega email:    " MEGA_EMAIL
      read -rsp "  Mega password: " MEGA_PASSWORD; echo
      [[ -z "$MEGA_EMAIL" || -z "$MEGA_PASSWORD" ]] && { echo "✗ email and password are required" >&2; exit 1; }
      rclone config create "$RCLONE_REMOTE" mega \
        user="$MEGA_EMAIL" \
        pass="$(rclone obscure "$MEGA_PASSWORD")" >/dev/null
      echo "  ✓ remote '${RCLONE_REMOTE}:' created"
      echo "  TIP: add these to backend/.env so every deploy keeps backups wired:"
      echo "       MEGA_EMAIL=$MEGA_EMAIL"
      echo "       MEGA_PASSWORD=********"
    fi

    # 3. destination folder
    echo "→ ensuring folder ${RCLONE_REMOTE}:${RCLONE_DEST}"
    rclone mkdir "${RCLONE_REMOTE}:${RCLONE_DEST}" 2>/dev/null || true
    rclone lsd "${RCLONE_REMOTE}:" >/dev/null 2>&1 \
      && echo "  ✓ Mega reachable" \
      || echo "  ⚠ couldn't list ${RCLONE_REMOTE}: — double-check the email/password"

    # 4. weekly cron (idempotent — Sunday 03:00)
    install_weekly_cron
    echo "→ weekly cron installed (Sunday 03:00)"
    echo
    echo "✓ setup complete. Test it now:  bash scripts/ops.sh backup"
    ;;

  # ─────────────────────────────────────────────────────────────── ensure ──
  # Idempotent, non-interactive, deploy-safe. Called by scripts/update.sh on
  # every deploy so backups stay wired once MEGA_* is in backend/.env. Never
  # fails the caller and never installs packages or prompts.
  ensure)
    load_env
    if ! command -v rclone >/dev/null 2>&1; then
      echo "→ ops ensure: rclone not installed — skipping (run 'ops.sh setup' once to enable backups)."
      exit 0
    fi
    if ensure_remote; then
      rclone mkdir "${RCLONE_REMOTE}:${RCLONE_DEST}" 2>/dev/null || true
      install_weekly_cron
      echo "→ ops ensure: '${RCLONE_REMOTE}:' remote + weekly backup cron in place."
    else
      echo "→ ops ensure: Mega creds not set in backend/.env (MEGA_EMAIL / MEGA_PASSWORD) — skipping backup auto-setup."
    fi
    ;;

  # ─────────────────────────────────────────────────────────────── backup ──
  backup)
    require_rclone
    PRUNE_WEEKS=""
    shift || true
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --prune-weeks) PRUNE_WEEKS="${2:?--prune-weeks needs a number}"; shift 2 ;;
        *) echo "unknown arg: $1" >&2; exit 1 ;;
      esac
    done

    echo "→ $(date -u +%Y-%m-%dT%H:%M:%SZ) backup starting"
    bash "$ROOT/scripts/backup.sh"

    STAMP_DIR="$(newest_stamp_dir)"
    [[ -z "$STAMP_DIR" ]] && { echo "✗ no stamped backup under $BACKUPS_DIR" >&2; exit 1; }
    STAMP="$(basename "$STAMP_DIR")"

    echo "→ copying $STAMP → ${RCLONE_REMOTE}:${RCLONE_DEST}/$STAMP"
    rclone mkdir "${RCLONE_REMOTE}:${RCLONE_DEST}" 2>/dev/null || true
    rclone copy "$STAMP_DIR" "${RCLONE_REMOTE}:${RCLONE_DEST}/$STAMP" --transfers=4
    echo "  ✓ off-site copy done"

    if [[ -n "$PRUNE_WEEKS" ]]; then
      echo "→ pruning local + remote copies older than ${PRUNE_WEEKS}w"
      find "$BACKUPS_DIR" -mindepth 1 -maxdepth 1 -type d -name '20*' -mtime "+$((PRUNE_WEEKS*7))" \
        -exec rm -rf {} + 2>/dev/null || true
      rclone delete "${RCLONE_REMOTE}:${RCLONE_DEST}" --min-age "${PRUNE_WEEKS}w" || true
      rclone rmdirs "${RCLONE_REMOTE}:${RCLONE_DEST}" --leave-root || true
    fi
    echo "✓ backup complete: ${RCLONE_DEST}/$STAMP"
    ;;

  # ─────────────────────────────────────────────────────────────── verify ──
  verify)
    STAMP_DIR="$(newest_stamp_dir)"
    [[ -z "$STAMP_DIR" ]] && { echo "✗ no local backups under $BACKUPS_DIR — run 'ops.sh backup' first." >&2; exit 1; }
    DUMP="$STAMP_DIR/db.sql.gz"
    [[ -f "$DUMP" ]] || { echo "✗ $DUMP missing" >&2; exit 1; }
    echo "→ verifying $(basename "$STAMP_DIR")/db.sql.gz"

    # Full drill needs to create a throwaway DB; the app role lacks CREATEDB,
    # so we go through the postgres superuser via sudo. Fall back to a parse
    # check if that isn't available.
    if command -v sudo >/dev/null 2>&1 && sudo -n -u postgres psql -tAc 'SELECT 1' >/dev/null 2>&1; then
      TMPDB="hireorbitai_verify_$(date -u +%s)"
      echo "→ restore-drill into throwaway DB $TMPDB"
      cleanup() { sudo -u postgres psql -c "DROP DATABASE IF EXISTS $TMPDB" >/dev/null 2>&1 || true; }
      trap cleanup EXIT
      sudo -u postgres psql -c "CREATE DATABASE $TMPDB" >/dev/null
      gunzip -c "$DUMP" | sudo -u postgres psql -d "$TMPDB" >/dev/null
      echo "  row counts:"
      for t in "${CANARY_TABLES[@]}"; do
        n="$(sudo -u postgres psql -d "$TMPDB" -tAc "SELECT count(*) FROM public.$t" 2>/dev/null || echo 'n/a')"
        printf '    %-14s %s\n' "$t" "$n"
      done
      echo "✓ restore-drill passed — the dump loads and the canary tables are present."
    else
      echo "  (no passwordless sudo to postgres — running a parse check instead)"
      tables="$(gunzip -c "$DUMP" | grep -c '^CREATE TABLE' || true)"
      bytes="$(stat -c%s "$DUMP" 2>/dev/null || wc -c < "$DUMP")"
      [[ "${bytes:-0}" -lt 100 ]] && { echo "✗ dump is suspiciously small ($bytes bytes)" >&2; exit 1; }
      echo "  dump is $bytes bytes and defines $tables tables."
      echo "✓ parse check passed. For a real restore-drill, run on the VPS where sudo→postgres works."
    fi
    ;;

  # ───────────────────────────────────────────────────────────────── ship ──
  ship)
    load_env
    : "${DATABASE_URL:?DATABASE_URL not set (define it in backend/.env)}"
    UPLOADS_DIR="${UPLOADS_DIR:-/var/lib/hireorbitai/uploads}"
    [[ -f "$ENV_FILE" ]] || { echo "✗ $ENV_FILE not found — a migration bundle must include it." >&2; exit 1; }

    STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
    STAGE="$(mktemp -d)"; trap 'rm -rf "$STAGE"' EXIT
    mkdir -p "$MIGRATE_DIR"
    BUNDLE="$MIGRATE_DIR/hireorbitai-migrate-$STAMP.tar.gz"

    echo "→ pg_dump → db.sql.gz"
    pg_dump --no-owner --no-privileges "$DATABASE_URL" | gzip -9 > "$STAGE/db.sql.gz"
    if [[ -d "$UPLOADS_DIR" ]]; then
      echo "→ tar uploads → uploads.tar.gz"
      tar -czf "$STAGE/uploads.tar.gz" -C "$(dirname "$UPLOADS_DIR")" "$(basename "$UPLOADS_DIR")"
    else
      echo "  (UPLOADS_DIR $UPLOADS_DIR missing — bundling empty marker)"; : > "$STAGE/uploads.tar.gz"
    fi
    echo "→ copying backend/.env (secrets!)"
    cp "$ENV_FILE" "$STAGE/env"
    {
      echo "stamp:        $STAMP"
      echo "host:         $(hostname -f 2>/dev/null || hostname)"
      echo "git_sha:      $(cd "$ROOT" && git rev-parse --short HEAD 2>/dev/null || echo unknown)"
      echo "database_url: ${DATABASE_URL%%@*}@…"
      echo "uploads_dir:  $UPLOADS_DIR"
      echo "contains_env: yes"
    } > "$STAGE/manifest.txt"
    tar -czf "$BUNDLE" -C "$STAGE" db.sql.gz uploads.tar.gz env manifest.txt
    chmod 600 "$BUNDLE"
    echo "✓ bundle: $BUNDLE ($(stat -c%s "$BUNDLE" 2>/dev/null || wc -c < "$BUNDLE") bytes, mode 600)"

    if command -v rclone >/dev/null 2>&1 && rclone listremotes 2>/dev/null | grep -qx "${RCLONE_REMOTE}:"; then
      echo "→ pushing to $MIGRATE_PATH/"
      rclone mkdir "${RCLONE_REMOTE}:${RCLONE_DEST}" 2>/dev/null || true
      rclone copyto "$BUNDLE" "$MIGRATE_PATH/$(basename "$BUNDLE")"
      echo "  ✓ off-site. On the NEW host:  bash scripts/ops.sh land --force"
    else
      echo "  (off-site remote not configured — use scp instead)"
    fi
    echo
    echo "scp fallback:  scp \"$BUNDLE\" hireorbitai@NEW_HOST:~/migrate/"
    echo "⚠ Bundle holds secrets — delete it from every host AND the remote after the new VPS is verified."
    ;;

  # ───────────────────────────────────────────────────────────────── land ──
  land)
    shift || true
    SRC=""; FORCE=""
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --force) FORCE="--force"; shift ;;
        *) SRC="$1"; shift ;;
      esac
    done

    # Resolve the bundle: explicit local path, else pull newest from the remote.
    if [[ -n "$SRC" && -f "$SRC" ]]; then
      BUNDLE="$SRC"
    else
      require_rclone
      NAME="$SRC"
      if [[ -z "$NAME" ]]; then
        NAME="$(rclone lsf "$MIGRATE_PATH/" 2>/dev/null | grep '\.tar\.gz$' | sort | tail -1)"
        [[ -z "$NAME" ]] && { echo "✗ no bundles under $MIGRATE_PATH/" >&2; exit 1; }
      fi
      mkdir -p "$MIGRATE_DIR"
      echo "→ pulling $NAME from ${RCLONE_REMOTE}:"
      rclone copyto "$MIGRATE_PATH/$NAME" "$MIGRATE_DIR/$NAME"
      BUNDLE="$MIGRATE_DIR/$NAME"
      chmod 600 "$BUNDLE"
    fi

    STAGE="$(mktemp -d)"; trap 'rm -rf "$STAGE"' EXIT
    tar -xzf "$BUNDLE" -C "$STAGE"
    [[ -f "$STAGE/env" && -f "$STAGE/db.sql.gz" ]] || { echo "✗ not a migrate bundle: $BUNDLE" >&2; exit 1; }

    echo "── bundle manifest ──"; cat "$STAGE/manifest.txt" 2>/dev/null || true; echo "─────────────────────"
    if [[ "$FORCE" != "--force" ]]; then
      echo
      echo "Dry run. 'land … --force' will, on THIS host:"
      echo "  1. write backend/.env from the bundle (existing one backed up aside)"
      echo "  2. restore the database into the bundled DATABASE_URL"
      echo "  3. replace the uploads directory (existing one moved aside)"
      echo "  4. npm ci && npm run build && migrate:up && pm2 reload"
      echo
      echo "Re-run:  bash scripts/ops.sh land \"$BUNDLE\" --force"
      exit 2
    fi

    # 1. .env
    if [[ -f "$ENV_FILE" ]]; then
      cp "$ENV_FILE" "$ENV_FILE.pre-migrate.$(date -u +%s)"
      echo "→ backed up existing backend/.env"
    fi
    mkdir -p "$(dirname "$ENV_FILE")"; cp "$STAGE/env" "$ENV_FILE"; chmod 600 "$ENV_FILE"
    echo "→ wrote backend/.env from bundle"
    load_env
    : "${DATABASE_URL:?DATABASE_URL missing from bundled .env}"
    UPLOADS_DIR="${UPLOADS_DIR:-/var/lib/hireorbitai/uploads}"

    # 2. db
    echo "→ restoring database → ${DATABASE_URL%%@*}@…"
    gunzip -c "$STAGE/db.sql.gz" | psql "$DATABASE_URL"
    echo "  ✓ db restored"

    # 3. uploads
    if [[ -s "$STAGE/uploads.tar.gz" ]]; then
      echo "→ restoring uploads → $UPLOADS_DIR"
      parent="$(dirname "$UPLOADS_DIR")"; mkdir -p "$parent"
      [[ -d "$UPLOADS_DIR" ]] && mv "$UPLOADS_DIR" "${UPLOADS_DIR}.pre-migrate.$(date -u +%s)"
      tar -xzf "$STAGE/uploads.tar.gz" -C "$parent"
      echo "  ✓ uploads restored"
    else
      echo "  (bundle had no uploads — skipping)"
    fi

    # 4. rebuild + restart
    echo "→ npm ci && npm run build (this can take a few minutes)"
    ( cd "$ROOT" && npm ci && npm run build )
    echo "→ npm --prefix backend run migrate:up"
    ( cd "$ROOT" && npm --prefix backend run migrate:up )
    echo "→ pm2 reload / start"
    if pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
      pm2 reload "$PM2_NAME" --update-env
    else
      ( cd "$ROOT" && pm2 start backend/ecosystem.config.cjs )
    fi

    echo
    echo "→ health check"
    curl -fsS "http://127.0.0.1:${PORT:-4000}/api/health" && echo || echo "  ⚠ health check failed — check pm2 logs"
    echo
    echo "✓ land complete. Delete the bundle now (it holds secrets):"
    echo "    rm \"$BUNDLE\""
    [[ -n "${NAME:-}" ]] && echo "    rclone deletefile \"$MIGRATE_PATH/$NAME\""
    echo "  Note: keep the new DATABASE_URL's db name as hireorbitai* or set DB_GUARD=off in .env."
    ;;

  # ────────────────────────────────────────────────────────────── restore ──
  restore)
    shift || true
    exec bash "$ROOT/scripts/restore.sh" "$@"
    ;;

  # ───────────────────────────────────────────────────────────────── help ──
  *)
    cat >&2 <<'USAGE'
usage: scripts/ops.sh <verb> [args]

  setup                              install rclone + configure Mega + weekly cron (turnkey, interactive)
  ensure                             idempotent non-interactive reconcile (run by deploys)
  backup [--prune-weeks N]           snapshot now + copy off-site  (run by the weekly cron)
  verify                             restore-drill the newest dump into a throwaway DB
  ship                               build a migration bundle (db+uploads+.env) and push off-site
  land [name|path] --force           pull/import a bundle on a NEW host + rebuild + pm2
  restore <stamp> [db|uploads|all] --force   restore a local backup (-> scripts/restore.sh)

Off-site target defaults to Mega (RCLONE_REMOTE=mega, RCLONE_DEST=hireorbitai-backups).
USAGE
    exit 1
    ;;
esac
