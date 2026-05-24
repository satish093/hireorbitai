#!/usr/bin/env bash
# =============================================================================
# setup-claude-auth.sh
#
# One-time setup: authenticate the VPS with your Claude.ai subscription so
# HireOrbit AI training generation uses your Claude Max plan instead of
# pay-per-token API credits.
#
# How it works:
#   1. Installs the Claude Code CLI globally (npm i -g @anthropic-ai/claude-code)
#   2. Runs `claude login` — the device-auth flow prints a URL; you open it on
#      your local PC, approve the request, and the VPS receives the token.
#   3. Extracts the OAuth token from ~/.claude/credentials.json
#   4. Writes ANTHROPIC_OAUTH_TOKEN + TRAINING_AI_PROVIDER=oauth into .env
#   5. Restarts the PM2 process so the new credentials take effect.
#
# Usage (run on the VPS as the hireorbitai site user):
#   bash ~/hireorbitai/scripts/setup-claude-auth.sh
#
# To revert to API key mode:
#   bash ~/hireorbitai/scripts/setup-claude-auth.sh --revert
# =============================================================================

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/backend/.env"
PM2_NAME="${PM2_NAME:-hireorbitai-api}"
CREDS_FILE="${CLAUDE_CREDS_FILE:-$HOME/.claude/credentials.json}"

# ── Colour helpers ──────────────────────────────────────────────────────────
red()    { printf '\033[0;31m%s\033[0m\n' "$*"; }
green()  { printf '\033[0;32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[0;33m%s\033[0m\n' "$*"; }
bold()   { printf '\033[1m%s\033[0m\n' "$*"; }

# ── Revert mode ─────────────────────────────────────────────────────────────
if [[ "${1:-}" == "--revert" ]]; then
  echo "→ Reverting to API key mode (TRAINING_AI_PROVIDER=api)…"
  if [[ ! -f "$ENV_FILE" ]]; then
    red "✗ .env not found at $ENV_FILE"; exit 1
  fi
  # Remove the OAuth token line and flip the provider back to 'api'
  sed -i '/^ANTHROPIC_OAUTH_TOKEN=/d' "$ENV_FILE"
  if grep -q '^TRAINING_AI_PROVIDER=' "$ENV_FILE"; then
    sed -i 's/^TRAINING_AI_PROVIDER=.*/TRAINING_AI_PROVIDER=api/' "$ENV_FILE"
  fi
  echo "→ Restarting $PM2_NAME…"
  pm2 restart "$PM2_NAME" --update-env
  green "✓ Reverted. Training AI now uses ANTHROPIC_API_KEY."
  exit 0
fi

# ── Preflight checks ─────────────────────────────────────────────────────────
bold "=== HireOrbit AI — Claude subscription auth setup ==="
echo ""

if [[ ! -f "$ENV_FILE" ]]; then
  red "✗ backend/.env not found at $ENV_FILE"
  echo "  Create it first:  cp $ROOT/backend/.env.example $ENV_FILE"
  exit 1
fi

# ── Step 1: install Claude Code CLI ─────────────────────────────────────────
if command -v claude &>/dev/null; then
  CLAUDE_VER="$(claude --version 2>/dev/null || echo '?')"
  echo "✓ Claude Code CLI already installed ($CLAUDE_VER)"
else
  echo "→ Installing Claude Code CLI globally…"
  npm install -g @anthropic-ai/claude-code --quiet
  echo "✓ Claude Code CLI installed: $(claude --version)"
fi

# ── Step 2: device-auth login ─────────────────────────────────────────────────
echo ""
bold "Step 1 of 2 — Log in with your Claude.ai account"
echo ""
yellow "  Claude will print a URL below."
yellow "  Open it in your browser (on any PC), log in, and approve the request."
yellow "  This terminal will wait until you confirm."
echo ""

# The auth subcommand in Claude Code CLI v2.x is `claude auth login`.
# Running plain `claude login` launches the interactive TUI (wrong).
if claude auth login 2>&1; then
  echo ""
  green "✓ Login successful"
else
  echo ""
  red "✗ 'claude auth login' failed."
  echo "  Try running it manually:  claude auth login"
  exit 1
fi

# ── Step 3: extract the OAuth token ──────────────────────────────────────────
echo ""
echo "→ Reading token from $CREDS_FILE…"

if [[ ! -f "$CREDS_FILE" ]]; then
  red "✗ Credentials file not found: $CREDS_FILE"
  echo "  claude login may have stored credentials elsewhere."
  echo "  Check: find ~ -name 'credentials.json' 2>/dev/null"
  exit 1
fi

# Try several field names — the Claude Code SDK has changed the key name across
# versions:  oauthToken  →  accessToken  →  claudeAiOAuth.accessToken
extract_token() {
  local file="$1"
  # 1. Top-level "oauthToken"
  local tok
  tok="$(node -e "
    const c = JSON.parse(require('fs').readFileSync('$file','utf8'));
    const t = c.oauthToken
           || c.accessToken
           || (c.claudeAiOAuth && c.claudeAiOAuth.accessToken)
           || (c.oauth && c.oauth.accessToken)
           || '';
    process.stdout.write(t);
  " 2>/dev/null || echo '')"
  echo "$tok"
}

OAUTH_TOKEN="$(extract_token "$CREDS_FILE")"

if [[ -z "$OAUTH_TOKEN" || "${#OAUTH_TOKEN}" -lt 20 ]]; then
  echo ""
  yellow "⚠ Could not auto-extract the token. Showing credentials.json structure:"
  node -e "
    const c = JSON.parse(require('fs').readFileSync('$CREDS_FILE','utf8'));
    console.log(JSON.stringify(Object.keys(c), null, 2));
  " || true
  echo ""
  echo "Please paste the token manually (it starts with 'sk-ant-' or similar):"
  read -r -s OAUTH_TOKEN
  echo ""
fi

if [[ -z "$OAUTH_TOKEN" || "${#OAUTH_TOKEN}" -lt 20 ]]; then
  red "✗ No token provided — aborting."
  exit 1
fi

DISPLAY_TOKEN="${OAUTH_TOKEN:0:12}…${OAUTH_TOKEN: -4}"
green "✓ Token extracted: $DISPLAY_TOKEN"

# ── Step 4: write to .env ─────────────────────────────────────────────────────
echo ""
bold "Step 2 of 2 — Updating backend/.env"

# Back up the current .env
cp "$ENV_FILE" "${ENV_FILE}.bak.$(date +%Y%m%d%H%M%S)"
echo "  (backup saved as ${ENV_FILE}.bak.*)"

# Remove any existing ANTHROPIC_OAUTH_TOKEN line
sed -i '/^ANTHROPIC_OAUTH_TOKEN=/d' "$ENV_FILE"

# Append the new token
echo "" >> "$ENV_FILE"
echo "# Added by scripts/setup-claude-auth.sh on $(date)" >> "$ENV_FILE"
echo "ANTHROPIC_OAUTH_TOKEN=$OAUTH_TOKEN" >> "$ENV_FILE"

# Flip or add TRAINING_AI_PROVIDER=oauth
if grep -q '^TRAINING_AI_PROVIDER=' "$ENV_FILE"; then
  sed -i 's/^TRAINING_AI_PROVIDER=.*/TRAINING_AI_PROVIDER=oauth/' "$ENV_FILE"
else
  echo "TRAINING_AI_PROVIDER=oauth" >> "$ENV_FILE"
fi

green "✓ .env updated"

# ── Step 5: restart PM2 ───────────────────────────────────────────────────────
echo ""
echo "→ Restarting $PM2_NAME to pick up new credentials…"
pm2 restart "$PM2_NAME" --update-env
echo ""

# Quick smoke check
sleep 2
HTTP_CODE="$(curl -sS -o /dev/null -w '%{http_code}' https://hireorbitai.com/api/health 2>/dev/null || echo '000')"
if [[ "$HTTP_CODE" == "200" ]]; then
  green "✓ API is up (HTTP 200)"
else
  yellow "⚠ Smoke check returned HTTP $HTTP_CODE — check pm2 logs $PM2_NAME --lines 30"
fi

echo ""
bold "All done!"
echo ""
echo "  Training generation will now use your Claude.ai subscription."
echo "  To revert:  bash scripts/setup-claude-auth.sh --revert"
echo ""
