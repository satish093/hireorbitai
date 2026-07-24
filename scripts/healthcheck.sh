#!/usr/bin/env bash
# Curl matrix against the public HireOrbit AI surface.
#
# Usage:
#   bash scripts/healthcheck.sh                    # defaults to APP_URL or https://hireorbitai.com
#   bash scripts/healthcheck.sh https://staging.hireorbitai.com
#
# Exits 0 only if every probe is "OK". Useful as a post-deploy smoke test and
# as a cron-driven external monitor.
#
set -uo pipefail

BASE="${1:-${APP_URL:-https://hireorbitai.com}}"
BASE="${BASE%/}"

fail=0
declare -a results=()

# probe <method> <url-suffix> <expected-status-regex> <label>
probe() {
  local method=$1 path=$2 expect=$3 label=$4
  local code
  code=$(curl -sS -o /tmp/hc.body -w "%{http_code}" -X "$method" "$BASE$path" || echo "000")
  if [[ "$code" =~ $expect ]]; then
    results+=("  ✓ ${label} (${method} ${path}) — HTTP ${code}")
  else
    results+=("  ✗ ${label} (${method} ${path}) — HTTP ${code}")
    fail=1
  fi
}

echo "→ ${BASE}"
echo

probe GET  ""              "^(200|301|302)$"  "frontend index"
probe GET  "/api/healthz"  "^200$"            "backend healthz"
probe GET  "/api/ready"    "^200$"            "backend ready (DB reachable)"
# /auth/me without a token must 401, not 5xx — proves the auth pipeline loads.
probe GET  "/api/auth/me"  "^401$"            "auth pipeline (no token → 401)"
# Refresh with a bogus token must 401 without falling through to a 5xx.
probe POST "/api/auth/refresh" "^(400|401)$"  "auth refresh (bogus → 4xx)"

# TLS sanity (best-effort; some hosts/curls don't expose --cacert behaviour).
if command -v openssl >/dev/null 2>&1; then
  host="${BASE#https://}"
  host="${host#http://}"
  host="${host%%/*}"
  if openssl s_client -servername "$host" -connect "$host:443" -brief </dev/null >/tmp/hc.tls 2>&1; then
    results+=("  ✓ TLS handshake to $host")
  else
    results+=("  ✗ TLS handshake to $host")
    fail=1
  fi
fi

printf '%s\n' "${results[@]}"

if [[ $fail -ne 0 ]]; then
  echo
  echo "✗ healthcheck FAILED"
  exit 1
fi

echo
echo "✓ all probes green"
