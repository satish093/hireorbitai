#!/usr/bin/env bash
# Pull-based auto-deploy for HireOrbit AI.
#
# Why: the push-to-deploy GitHub Action SSHes in from GitHub's runners, but the
# hardened VPS firewall drops those (rotating, 6500+ CIDR) IPs — the deploy fails
# with `dial tcp … i/o timeout`. Rather than reopen SSH to the world (and undo
# the June-2 hardening), the VPS *pulls*: cron runs this every few minutes; if
# `origin/main` has advanced it runs the normal deploy (scripts/update.sh).
# No inbound connection, no firewall change, no new attack surface.
#
# Install (as the deploy user, e.g. hireorbitai) — `crontab -e`, add:
#   */3 * * * * /bin/bash -lc '$HOME/hireorbitai/scripts/auto-pull.sh' >> $HOME/auto-pull.log 2>&1
# The `bash -lc` login shell ensures node/npm/pm2 (nvm/PATH) are available, the
# same environment a manual `bash scripts/update.sh` runs in.
#
# A flock guard means a slow build never stacks with the next cron tick.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BRANCH="${AUTO_PULL_BRANCH:-main}"
LOCK="/tmp/hireorbit-auto-pull.lock"
stamp() { date -u +%FT%TZ; }

# Single-flight: if a deploy is already running, skip this tick (don't queue).
exec 9>"$LOCK"
if ! flock -n 9; then
  echo "$(stamp) auto-pull: a deploy already holds the lock — skipping"
  exit 0
fi

# Refresh the remote ref only (update.sh does the actual ff-only pull + build).
if ! git fetch --quiet origin "$BRANCH" --prune; then
  echo "$(stamp) auto-pull: git fetch failed — skipping this tick"
  exit 0
fi

local_sha="$(git rev-parse HEAD)"
remote_sha="$(git rev-parse "origin/$BRANCH")"

# Up to date → quiet exit (no log spam every few minutes).
[[ "$local_sha" == "$remote_sha" ]] && exit 0

# Only deploy when we're strictly BEHIND origin (a fast-forward is possible).
# If local has diverged somehow, don't blindly run update.sh — surface it.
if ! git merge-base --is-ancestor HEAD "origin/$BRANCH"; then
  echo "$(stamp) auto-pull: local HEAD ${local_sha:0:7} is not an ancestor of origin/$BRANCH ${remote_sha:0:7} — refusing to auto-deploy a diverged tree"
  exit 1
fi

echo "$(stamp) auto-pull: $BRANCH advanced ${local_sha:0:7} → ${remote_sha:0:7} — deploying"
bash scripts/update.sh
echo "$(stamp) auto-pull: deploy complete (now at $(git rev-parse --short HEAD))"
