#requires -Version 5.1
<#
.SYNOPSIS
  Stop the local HireOrbit AI dev servers on Windows.

.DESCRIPTION
  Kills the Node processes listening on the dev ports (4000 = backend,
  5173 = Vite frontend). Doesn't touch any other Node process you have
  running.

.EXAMPLE
  .\scripts\stop-dev-windows.ps1
#>

param(
  [int[]]$Ports = @(4000, 5173)
)

$ErrorActionPreference = 'SilentlyContinue'
$any = $false

foreach ($port in $Ports) {
  $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  if (-not $conns) {
    Write-Host "  (no listener on port $port)" -ForegroundColor DarkGray
    continue
  }
  foreach ($c in $conns) {
    $proc = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue
    if ($proc) {
      Write-Host ("→ stopping " + $proc.Name + " (pid " + $proc.Id + ", port " + $port + ")") -ForegroundColor Cyan
      Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
      $any = $true
    }
  }
}

if (-not $any) {
  Write-Host '  nothing to stop.' -ForegroundColor DarkGray
} else {
  Write-Host '  ✓ stopped.' -ForegroundColor Green
}
