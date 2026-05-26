#!/usr/bin/env bash
# Weekly off-site backup to Cloudflare R2 via rclone (free tier: 10 GB, zero egress).
#
# Takes a fresh local snapshot with scripts/backup.sh (database + uploads), then
# copies that stamped folder to an S3-compatible bucket. Defaults target a
# Cloudflare R2 remote named "r2", but any rclone remote works (S3, B2, Drive…)
# via the RCLONE_REMOTE / RCLONE_DEST overrides. Meant to run from cron at the
# end of each week:
#
#   0 3 * * 0 /home/hireorbitai/hireorbitai/scripts/backup-offsite.sh \
#       >> /home/hireorbitai/backups/backup-offsite.log 2>&1
#
# One-time setup (see docs/deployment/production.md → "Weekly off-site backup (Cloudflare R2)"):
#   curl https://rclone.org/install.sh | sudo bash
#   rclone config        # create a remote named "r2" of type "s3", provider Cloudflare
#
# Usage:
#   bash scripts/backup-offsite.sh                  # snapshot + push newest to R2
#   bash scripts/backup-offsite.sh --no-snapshot    # push the newest EXISTING stamp only
#   bash scripts/backup-offsite.sh --prune-weeks 8  # also delete remote copies older than 8w
#
# Env overrides:
#   RCLONE_REMOTE   rclone remote name        (default: r2)
#   RCLONE_DEST     bucket / folder           (default: hireorbitai-backups)
#   BACKUPS_DIR     local backups root        (default: ~/backups)
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUPS_DIR="${BACKUPS_DIR:-$HOME/backups}"
RCLONE_REMOTE="${RCLONE_REMOTE:-r2}"
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
  echo "  See docs/deployment/production.md → Weekly off-site backup (Cloudflare R2)." >&2
  exit 1
fi
if ! rclone listremotes 2>/dev/null | grep -qx "${RCLONE_REMOTE}:"; then
  echo "✗ rclone remote '${RCLONE_REMOTE}:' not found. Create it with: rclone config" >&2
  echo "  (configured remotes: $(rclone listremotes 2>/dev/null | tr '\n' ' ')) " >&2
  exit 1
fi

echo "→ $(date -u +%Y-%m-%dT%H:%M:%SZ) weekly off-site backup starting (${RCLONE_REMOTE}:)"

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

# ── 3. Copy to the off-site bucket ───────────────────────────────────────────
# Ensure the bucket/path exists (no-op if it already does; R2 buckets are
# usually pre-created, but this keeps a first run from failing).
rclone mkdir "${RCLONE_REMOTE}:${RCLONE_DEST}" 2>/dev/null || true
rclone copy "$STAMP_DIR" "${RCLONE_REMOTE}:${RCLONE_DEST}/$STAMP" --transfers=4
echo "  ✓ uploaded to ${RCLONE_REMOTE}:${RCLONE_DEST}/$STAMP"

# ── 4. Optional retention on the bucket ──────────────────────────────────────
if [[ -n "$PRUNE_WEEKS" ]]; then
  echo "→ pruning remote copies older than ${PRUNE_WEEKS}w"
  rclone delete "${RCLONE_REMOTE}:${RCLONE_DEST}" --min-age "${PRUNE_WEEKS}w" || true
  rclone rmdirs "${RCLONE_REMOTE}:${RCLONE_DEST}" --leave-root || true
fi

echo "✓ $(date -u +%Y-%m-%dT%H:%M:%SZ) weekly off-site backup complete: ${RCLONE_DEST}/$STAMP"
