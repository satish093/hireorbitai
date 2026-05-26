#!/usr/bin/env bash
# Weekly off-site backup to Google Drive via rclone (free).
#
# Takes a fresh local snapshot with scripts/backup.sh, then copies that stamped
# folder to Google Drive. Meant to run from cron at the end of each week:
#
#   0 3 * * 0 /home/hireorbitai/hireorbitai/scripts/backup-gdrive.sh \
#       >> /home/hireorbitai/backups/backup-gdrive.log 2>&1
#
# One-time setup (see docs/deployment/production.md → "Weekly Google Drive backup"):
#   curl https://rclone.org/install.sh | sudo bash
#   rclone config        # create a remote named "gdrive" of type "drive"
#
# Usage:
#   bash scripts/backup-gdrive.sh                  # snapshot + push newest to Drive
#   bash scripts/backup-gdrive.sh --no-snapshot    # push the newest EXISTING stamp only
#   bash scripts/backup-gdrive.sh --prune-weeks 8  # also delete Drive copies older than 8w
#
# Env overrides:
#   RCLONE_REMOTE   rclone remote name        (default: gdrive)
#   RCLONE_DEST     folder within the remote  (default: hireorbitai-backups)
#   BACKUPS_DIR     local backups root        (default: ~/backups)
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUPS_DIR="${BACKUPS_DIR:-$HOME/backups}"
RCLONE_REMOTE="${RCLONE_REMOTE:-gdrive}"
RCLONE_DEST="${RCLONE_DEST:-hireorbitai-backups}"

SNAPSHOT=1
PRUNE_WEEKS=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-snapshot) SNAPSHOT=0; shift ;;
    --prune-weeks) PRUNE_WEEKS="${2:?--prune-weeks needs a number}"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done

# ── Guards ─────────────────────────────────────────────────────────────────
if ! command -v rclone >/dev/null 2>&1; then
  echo "✗ rclone is not installed. Install it then run 'rclone config':" >&2
  echo "    curl https://rclone.org/install.sh | sudo bash" >&2
  echo "  See docs/deployment/production.md → Weekly Google Drive backup." >&2
  exit 1
fi
if ! rclone listremotes 2>/dev/null | grep -qx "${RCLONE_REMOTE}:"; then
  echo "✗ rclone remote '${RCLONE_REMOTE}:' not found. Create it with: rclone config" >&2
  echo "  (configured remotes: $(rclone listremotes 2>/dev/null | tr '\n' ' ')) " >&2
  exit 1
fi

echo "→ $(date -u +%Y-%m-%dT%H:%M:%SZ) weekly Google Drive backup starting"

# ── 1. Take a fresh snapshot (unless told to reuse the newest) ───────────────
if [[ "$SNAPSHOT" -eq 1 ]]; then
  echo "→ taking a fresh local snapshot (scripts/backup.sh)"
  bash "$ROOT/scripts/backup.sh"
fi

# ── 2. Find the newest stamp folder ──────────────────────────────────────────
STAMP_DIR="$(find "$BACKUPS_DIR" -mindepth 1 -maxdepth 1 -type d -name '20*' 2>/dev/null \
  | sort | tail -1)"
if [[ -z "$STAMP_DIR" ]]; then
  echo "✗ no stamped backup folders under $BACKUPS_DIR" >&2
  exit 1
fi
STAMP="$(basename "$STAMP_DIR")"
echo "→ syncing $STAMP_DIR → ${RCLONE_REMOTE}:${RCLONE_DEST}/$STAMP"

# ── 3. Copy to Drive ─────────────────────────────────────────────────────────
rclone copy "$STAMP_DIR" "${RCLONE_REMOTE}:${RCLONE_DEST}/$STAMP" --transfers=4
echo "  ✓ uploaded to ${RCLONE_REMOTE}:${RCLONE_DEST}/$STAMP"

# ── 4. Optional retention on Drive ───────────────────────────────────────────
if [[ -n "$PRUNE_WEEKS" ]]; then
  echo "→ pruning Drive copies older than ${PRUNE_WEEKS}w"
  rclone delete "${RCLONE_REMOTE}:${RCLONE_DEST}" --min-age "${PRUNE_WEEKS}w" || true
  rclone rmdirs "${RCLONE_REMOTE}:${RCLONE_DEST}" --leave-root || true
fi

echo "✓ $(date -u +%Y-%m-%dT%H:%M:%SZ) weekly Google Drive backup complete: ${RCLONE_DEST}/$STAMP"
