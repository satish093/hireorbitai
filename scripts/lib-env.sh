#!/usr/bin/env bash
# Safe .env loader shared by the ops scripts.
#
# Unlike `set -a; source .env`, this NEVER executes the file, so values that are
# valid for Node's --env-file but not for the shell — secrets containing spaces,
# '!', '#', '(', '$', etc. — don't get word-split or run as commands. It reads
# KEY=VALUE lines from $ENV_FILE (set by the caller) and exports them verbatim.
#
# Usage:
#   ENV_FILE="$ROOT/backend/.env"
#   source "$(dirname "${BASH_SOURCE[0]}")/lib-env.sh"
#   load_env
load_env() {
  local f="${ENV_FILE:-}"
  [[ -n "$f" && -f "$f" ]] || return 0
  local line key val
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"                       # strip CR (Windows-edited files)
    [[ "$line" =~ ^[[:space:]]*(#.*)?$ ]] && continue   # blank / comment
    [[ "$line" == *"="* ]] || continue
    key="${line%%=*}"
    val="${line#*=}"
    key="${key#export }"                        # tolerate "export KEY=..."
    key="${key#"${key%%[![:space:]]*}"}"        # ltrim key
    key="${key%"${key##*[![:space:]]}"}"        # rtrim key
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    # Strip a single layer of matching surrounding quotes, if present.
    if [[ ${#val} -ge 2 && "$val" == \"*\" ]]; then
      val="${val#\"}"; val="${val%\"}"
    elif [[ ${#val} -ge 2 && "$val" == \'*\' ]]; then
      val="${val#\'}"; val="${val%\'}"
    fi
    export "$key=$val"
  done < "$f"
}
