<#
.SYNOPSIS
  Run an OWASP ZAP baseline (passive) scan against a running HireOrbit AI target.

.DESCRIPTION
  Wraps the official ZAP baseline Docker image. The baseline scan is PASSIVE —
  it spiders the target and inspects responses for common misconfigurations
  (missing security headers, cookie flags, info leaks). It does NOT attack the
  app, so it is safe to point at a local dev server or staging. Do NOT point it
  at production without authorization.

  This script is intentionally NOT wired into `npm run verify` or CI: it needs
  Docker and a running target, which the default fast feedback loop shouldn't
  depend on. Run it manually when you want a security header / config sweep.

.PARAMETER Target
  Base URL to scan. Default: http://localhost:5173 (the Vite dev server).
  Use your staging URL for a pre-prod sweep, e.g. https://staging.hireorbitai.com

.PARAMETER ReportDir
  Where to write the HTML/JSON reports. Default: ./zap-report (gitignored).

.EXAMPLE
  pwsh scripts/zap-baseline.ps1 -Target http://localhost:5173

.EXAMPLE
  pwsh scripts/zap-baseline.ps1 -Target https://staging.hireorbitai.com
#>
[CmdletBinding()]
param(
  [string]$Target = 'http://localhost:5173',
  [string]$ReportDir = './zap-report'
)

$ErrorActionPreference = 'Stop'

# Docker is required and not assumed to be present — fail with a clear message.
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Write-Error 'Docker is not installed or not on PATH. Install Docker Desktop, then re-run. The ZAP baseline scan runs inside the ghcr.io/zaproxy/zaproxy image.'
  exit 1
}

$resolved = (Resolve-Path -Path $ReportDir -ErrorAction SilentlyContinue)
if (-not $resolved) {
  New-Item -ItemType Directory -Path $ReportDir -Force | Out-Null
  $resolved = (Resolve-Path -Path $ReportDir)
}

Write-Host "ZAP baseline scan -> $Target"
Write-Host "Reports           -> $resolved"
Write-Host ''

# -t target, -I = don't fail the process on warnings (baseline always finds
# header nits), -r HTML report, -J JSON report. The container writes reports to
# /zap/wrk which we bind-mount to the local report dir.
docker run --rm `
  -v "${resolved}:/zap/wrk:rw" `
  ghcr.io/zaproxy/zaproxy:stable `
  zap-baseline.py `
  -t $Target `
  -I `
  -r zap-baseline-report.html `
  -J zap-baseline-report.json

$code = $LASTEXITCODE
Write-Host ''
Write-Host "ZAP finished (exit $code). Open $resolved\zap-baseline-report.html to review findings."
# ZAP exit codes: 0 = clean, 1 = at least one FAIL rule, 2 = at least one WARN.
# We surface the code but the -I flag keeps WARN-only runs at 0 so an
# unattended invocation isn't tripped by cosmetic header warnings.
exit $code
