#!/usr/bin/env bash
# zap-baseline.sh — OWASP ZAP passive (baseline) security scan for Linux/CI.
#
# Runs the official ZAP Docker image against a target URL in passive-only mode.
# Safe to run against staging; never run against production without a change freeze.
#
# Usage:
#   bash scripts/zap-baseline.sh [TARGET_URL] [REPORT_DIR]
#
# Defaults:
#   TARGET_URL  = http://localhost:5173
#   REPORT_DIR  = ./zap-report
#
# Exit codes (matches ZAP baseline conventions):
#   0  = no alerts (fully clean)
#   1  = FAIL rule triggered
#   2  = WARN rule triggered (informational)
#
# Requirements:
#   - Docker (the script pulls ghcr.io/zaproxy/zaproxy:stable if not cached)
#   - Network access to TARGET_URL from inside the Docker container
#
# CI use: called by .github/workflows/security-scan.yml. The workflow runs
# with continue-on-error:true so ZAP findings are informational, never blocking.
#
# Windows equivalent: scripts/zap-baseline.ps1 (PowerShell)

set -euo pipefail

TARGET="${1:-http://localhost:5173}"
REPORT_DIR="${2:-./zap-report}"

# Resolve to absolute path so the Docker bind-mount works regardless of cwd.
REPORT_DIR="$(realpath -m "$REPORT_DIR")"

echo "→ ZAP baseline scan"
echo "  Target:     $TARGET"
echo "  Report dir: $REPORT_DIR"
echo ""

mkdir -p "$REPORT_DIR"

# Pull the image explicitly first so the pull output is separated from the scan.
docker pull ghcr.io/zaproxy/zaproxy:stable --quiet

# Run the baseline scan. Flags:
#   -t <target>   URL to scan
#   -I            Don't fail on warning-level alerts (exit 2 instead of 1)
#   -r <file>     HTML report output (relative to /zap/wrk inside container)
#   -J <file>     JSON report output
#
# The /zap/wrk directory inside the container maps to REPORT_DIR on the host.
docker run --rm \
  -v "${REPORT_DIR}:/zap/wrk/:rw" \
  --network host \
  ghcr.io/zaproxy/zaproxy:stable \
  zap-baseline.py \
  -t "$TARGET" \
  -I \
  -r zap-report.html \
  -J zap-report.json \
  2>&1
ZAP_EXIT=$?

echo ""
echo "→ ZAP scan complete (exit code: $ZAP_EXIT)"
echo "  HTML report: $REPORT_DIR/zap-report.html"
echo "  JSON report: $REPORT_DIR/zap-report.json"

# Exit with ZAP's own code so CI can treat warnings vs. failures differently.
exit $ZAP_EXIT
