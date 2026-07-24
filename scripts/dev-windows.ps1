#requires -Version 5.1
<#
.SYNOPSIS
  One-shot local-dev bootstrap + launch for HireOrbit AI on Windows.

.DESCRIPTION
  Verifies prerequisites, sets up backend + frontend .env files (auto-generating
  secrets the first time), installs dependencies via npm workspaces, builds the
  shared/ package, applies database SQL, creates the SUPER_ADMIN, and finally
  opens two new PowerShell windows running `npm run dev` for backend + frontend.

  Idempotent — every step skips work that's already done. Safe to re-run.

.PARAMETER DatabaseName
  PostgreSQL database name. Default: hireorbitai

.PARAMETER DatabaseUser
  PostgreSQL role. Default: postgres (assumes local trust auth or password in
  PGPASSWORD env var).

.PARAMETER DatabasePassword
  Optional. Sets PGPASSWORD for the session so psql doesn't prompt. Falls back
  to whatever PGPASSWORD is already set.

.PARAMETER AdminEmail
  Initial SUPER_ADMIN email. Default: admin@hireorbitai.local

.PARAMETER AdminPassword
  Initial SUPER_ADMIN password (>= 12 chars). Auto-generated if omitted.

.PARAMETER SkipStart
  Bootstrap only — don't launch the dev servers. Use this for CI / scripted setup.

.PARAMETER SkipDatabase
  Don't touch the database. Use this if you've already applied the schema by hand.

.PARAMETER Force
  Re-write .env files even if they already exist (rotates the auto-generated
  secrets). Won't touch values an operator set by hand if they're outside the
  auto-managed block.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/dev-windows.ps1

.EXAMPLE
  .\scripts\dev-windows.ps1 -DatabasePassword 'mypass' -AdminEmail 'me@hireorbitai.local'

.EXAMPLE
  # Bootstrap only — useful for CI.
  .\scripts\dev-windows.ps1 -SkipStart
#>

[CmdletBinding()]
param(
  [string]$DatabaseName     = 'hireorbitai',
  [string]$DatabaseUser     = 'postgres',
  [string]$DatabasePassword = $env:PGPASSWORD,
  [string]$AdminEmail       = 'admin@hireorbitai.local',
  [string]$AdminPassword    = '',
  [switch]$SkipStart,
  [switch]$SkipDatabase,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

function Say($msg)  { Write-Host "→ $msg" -ForegroundColor Cyan }
function Ok($msg)   { Write-Host "  ✓ $msg" -ForegroundColor Green }
function Skip($msg) { Write-Host "  (skip) $msg" -ForegroundColor DarkGray }
function Warn($msg) { Write-Host "  ! $msg" -ForegroundColor Yellow }
function Die($msg)  { Write-Host "✗ $msg" -ForegroundColor Red; exit 1 }

function Require-Command($name, $hint) {
  $cmd = Get-Command $name -ErrorAction SilentlyContinue
  if (-not $cmd) { Die "$name not found on PATH. $hint" }
  return $cmd
}

function New-RandomSecret([int]$bytes = 48) {
  $buf = New-Object byte[] $bytes
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($buf)
  return [Convert]::ToBase64String($buf)
}

function Set-EnvKey([string]$path, [string]$key, [string]$value) {
  $line = "$key=$value"
  if (-not (Test-Path $path)) {
    Set-Content -Path $path -Value $line -Encoding utf8
    return
  }
  $content = Get-Content $path -Raw
  if ($content -match "(?m)^$([regex]::Escape($key))=") {
    $content = [regex]::Replace($content, "(?m)^$([regex]::Escape($key))=.*$", $line)
    Set-Content -Path $path -Value $content -NoNewline -Encoding utf8
  } else {
    Add-Content -Path $path -Value $line -Encoding utf8
  }
}

# ---------------------------------------------------------------------------
# Repo root + env layout
# ---------------------------------------------------------------------------

$RepoRoot     = (Resolve-Path "$PSScriptRoot/..").Path
$BackendDir   = Join-Path $RepoRoot 'backend'
$FrontendDir  = Join-Path $RepoRoot 'frontend'
$BackendEnv   = Join-Path $BackendDir '.env'
$BackendEnvEx = Join-Path $BackendDir '.env.example'
$FrontendEnv  = Join-Path $FrontendDir '.env'
$FrontendEnvEx= Join-Path $FrontendDir '.env.example'
$UploadsDir   = Join-Path $env:LOCALAPPDATA 'hireorbitai\uploads'

Push-Location $RepoRoot
try {

# ---------------------------------------------------------------------------
# 1. Prerequisites
# ---------------------------------------------------------------------------

Say 'Verifying prerequisites'

$nodeCmd = Require-Command node 'Install Node.js 22 from https://nodejs.org'
$nodeVersion = (& node -v).TrimStart('v')
$major = [int]($nodeVersion.Split('.')[0])
if ($major -lt 22) { Die "Node 22+ required (have v$nodeVersion). Run 'nvm use 22' or upgrade." }
Ok "node v$nodeVersion"

Require-Command npm 'npm should ship with Node — your install is broken if this is missing.' | Out-Null
Ok "npm $(& npm -v)"

$psqlCmd = $null
if (-not $SkipDatabase) {
  $psqlCmd = Get-Command psql -ErrorAction SilentlyContinue
  if (-not $psqlCmd) {
    Warn "psql not on PATH — install PostgreSQL or add 'C:\Program Files\PostgreSQL\<ver>\bin' to PATH."
    Warn "Continuing in -SkipDatabase mode. Apply database/*.sql manually before first sign-in."
    $SkipDatabase = $true
  } else {
    Ok "psql $(& psql --version)"
  }
}

# ---------------------------------------------------------------------------
# 2. .env files (generate secrets on first run)
# ---------------------------------------------------------------------------

Say 'Setting up .env files'

if ((-not (Test-Path $BackendEnv)) -or $Force) {
  if (Test-Path $BackendEnvEx) {
    Copy-Item -Force $BackendEnvEx $BackendEnv
    Ok 'backend/.env created from .env.example'
  } else {
    Set-Content -Path $BackendEnv -Value "# HireOrbit AI backend (local dev)`n" -Encoding utf8
    Warn 'backend/.env.example missing — wrote a stub'
  }

  $dbUrl = "postgres://$DatabaseUser`:$([Uri]::EscapeDataString($DatabasePassword))@127.0.0.1:5432/$DatabaseName"
  if (-not $DatabasePassword) { $dbUrl = "postgres://$DatabaseUser@127.0.0.1:5432/$DatabaseName" }

  # Local-dev defaults. Operators can override any of these by hand later.
  Set-EnvKey $BackendEnv 'NODE_ENV'              'development'
  Set-EnvKey $BackendEnv 'PORT'                  '4000'
  Set-EnvKey $BackendEnv 'APP_URL'               'http://localhost:4000'
  Set-EnvKey $BackendEnv 'CORS_ORIGIN'           'http://localhost:5173'
  Set-EnvKey $BackendEnv 'FRONTEND_URL'          'http://localhost:5173'
  Set-EnvKey $BackendEnv 'TRUST_PROXY'           '0'
  Set-EnvKey $BackendEnv 'DATABASE_URL'          $dbUrl
  Set-EnvKey $BackendEnv 'DATABASE_SSL'          'disable'
  Set-EnvKey $BackendEnv 'UPLOADS_DIR'           ($UploadsDir -replace '\\', '/')
  Set-EnvKey $BackendEnv 'STORAGE_URL_SECRET'    (New-RandomSecret)
  Set-EnvKey $BackendEnv 'JWT_SECRET'            (New-RandomSecret)
  Set-EnvKey $BackendEnv 'COOKIE_SECRET'         (New-RandomSecret)
  Set-EnvKey $BackendEnv 'BREVO_API_KEY'         'xkeysib-LOCAL-DEV-STUB-no-email-will-send'
  Set-EnvKey $BackendEnv 'BREVO_SENDER_EMAIL'    'noreply@hireorbitai.local'
  Set-EnvKey $BackendEnv 'BREVO_SENDER_NAME'     'HireOrbit AI (Dev)'
  Set-EnvKey $BackendEnv 'ANTHROPIC_API_KEY'     ''
  Set-EnvKey $BackendEnv 'DISABLE_JOBS'          'true'   # quiet background workers in local dev
  Ok 'backend/.env populated with auto-generated secrets'
} else {
  Skip 'backend/.env already exists (use -Force to regenerate)'
}

if ((-not (Test-Path $FrontendEnv)) -or $Force) {
  if (Test-Path $FrontendEnvEx) {
    Copy-Item -Force $FrontendEnvEx $FrontendEnv
  } else {
    Set-Content -Path $FrontendEnv -Value "" -Encoding utf8
  }
  Set-EnvKey $FrontendEnv 'VITE_API_URL' 'http://localhost:4000'
  Ok 'frontend/.env populated'
} else {
  Skip 'frontend/.env already exists (use -Force to regenerate)'
}

# Uploads dir
if (-not (Test-Path $UploadsDir)) {
  New-Item -ItemType Directory -Force -Path $UploadsDir | Out-Null
  Ok "Created uploads dir: $UploadsDir"
} else {
  Skip "Uploads dir exists: $UploadsDir"
}

# ---------------------------------------------------------------------------
# 3. npm install at the root (workspaces installs all three packages)
# ---------------------------------------------------------------------------

Say 'Installing dependencies (npm workspaces)'
& npm install --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { Die 'npm install failed' }
Ok 'dependencies installed'

Say 'Building shared/ package'
& npm run shared:build
if ($LASTEXITCODE -ne 0) { Die 'shared build failed' }
Ok 'shared/dist (esm + cjs) emitted'

# ---------------------------------------------------------------------------
# 4. Database — apply schema + feature modules
# ---------------------------------------------------------------------------

if (-not $SkipDatabase) {
  Say 'Applying database schema'

  if ($DatabasePassword) { $env:PGPASSWORD = $DatabasePassword }

  # Create the database if it doesn't exist. `psql -tAc` is silent on success.
  $exists = & psql -h 127.0.0.1 -U $DatabaseUser -tAc "SELECT 1 FROM pg_database WHERE datname='$DatabaseName'" postgres 2>$null
  if ($LASTEXITCODE -ne 0) {
    Warn 'Could not connect to Postgres on 127.0.0.1:5432.'
    Warn 'Start the service ("services.msc" → postgresql-x64-<ver>) or run with -SkipDatabase.'
    Die 'Database connection failed'
  }
  if (-not $exists) {
    & psql -h 127.0.0.1 -U $DatabaseUser -d postgres -c "CREATE DATABASE $DatabaseName" | Out-Null
    Ok "Created database $DatabaseName"
  } else {
    Skip "Database $DatabaseName already exists"
  }
  & psql -h 127.0.0.1 -U $DatabaseUser -d $DatabaseName -c "CREATE EXTENSION IF NOT EXISTS pgcrypto" | Out-Null

  # One consolidated file does the whole schema. Generated by
  # scripts/build-init-sql.mjs from every per-feature database/*.sql in
  # dependency order. Idempotent — safe to re-apply.
  $initSql = Join-Path $RepoRoot 'database/init.sql'
  if (Test-Path $initSql) {
    & psql -h 127.0.0.1 -U $DatabaseUser -d $DatabaseName -v ON_ERROR_STOP=1 -f $initSql > $null
    if ($LASTEXITCODE -ne 0) { Die 'Failed applying database/init.sql' }
    Ok 'applied database/init.sql (consolidated baseline)'
  } else {
    Warn 'database/init.sql missing — regenerate with: npm run db:build-init'
    Warn 'Falling back to individual files...'

    $baseline = @(
      'database/schema.sql',
      'database/auth-hardening.sql',
      'database/admin-user-management.sql',
      'database/feature-flags.sql'
    )
    foreach ($f in $baseline) {
      $full = Join-Path $RepoRoot $f
      if (Test-Path $full) {
        & psql -h 127.0.0.1 -U $DatabaseUser -d $DatabaseName -v ON_ERROR_STOP=1 -f $full > $null
        if ($LASTEXITCODE -ne 0) { Die "Failed applying $f" }
        Ok ("applied " + $f)
      }
    }
    $rest = Get-ChildItem -Path (Join-Path $RepoRoot 'database') -Filter *.sql |
            Where-Object { $_.Name -notin @('init.sql','schema.sql','auth-hardening.sql','admin-user-management.sql','feature-flags.sql','seed-default-admin.sql','accounts-teardown.sql') } |
            Sort-Object Name
    foreach ($f in $rest) {
      & psql -h 127.0.0.1 -U $DatabaseUser -d $DatabaseName -v ON_ERROR_STOP=1 -f $f.FullName > $null
      if ($LASTEXITCODE -ne 0) {
        Warn ("Skipping " + $f.Name + " (apply manually if needed)")
      } else {
        Ok ("applied " + $f.Name)
      }
    }
  }
} else {
  Skip 'Database step (SkipDatabase or psql missing)'
}

# ---------------------------------------------------------------------------
# 5. Bootstrap admin
# ---------------------------------------------------------------------------

if (-not $SkipDatabase) {
  Say 'Bootstrapping SUPER_ADMIN'

  if (-not $AdminPassword) {
    # Generate something memorable-ish: 4 random words won't be possible
    # without a dict; use base64 random bytes truncated to 16 chars + suffix.
    $raw = (New-RandomSecret 18) -replace '[^A-Za-z0-9]', ''
    $AdminPassword = ($raw.Substring(0, 14)) + '!1'
    Warn 'No -AdminPassword supplied; auto-generated one (shown below).'
  }

  $env:DEFAULT_ADMIN_EMAIL    = $AdminEmail
  $env:DEFAULT_ADMIN_PASSWORD = $AdminPassword
  $env:DEFAULT_ADMIN_NAME     = 'Local Admin'
  $env:DEFAULT_ADMIN_ROLE     = 'SUPER_ADMIN'

  Push-Location $BackendDir
  try {
    & npm run bootstrap:admin
    if ($LASTEXITCODE -ne 0) { Die 'bootstrap:admin failed' }
  } finally {
    Pop-Location
  }

  Ok 'Admin row ready'

  Write-Host ''
  Write-Host '============================================================' -ForegroundColor Yellow
  Write-Host '  First-time sign-in credentials' -ForegroundColor Yellow
  Write-Host '============================================================' -ForegroundColor Yellow
  Write-Host ("  Email:    " + $AdminEmail)
  Write-Host ("  Password: " + $AdminPassword) -ForegroundColor Yellow
  Write-Host '  (You will be forced to rotate this on first sign-in.)'
  Write-Host '============================================================' -ForegroundColor Yellow
  Write-Host ''
}

# ---------------------------------------------------------------------------
# 6. Launch dev servers (two new windows)
# ---------------------------------------------------------------------------

if ($SkipStart) {
  Say 'Skipping dev-server launch (-SkipStart was set)'
  Write-Host ''
  Write-Host 'To start manually:'
  Write-Host '  In one terminal:  cd backend  ; npm run dev'
  Write-Host '  In another:       cd frontend ; npm run dev'
} else {
  Say 'Launching dev servers in new windows'

  $backendCmd  = "Set-Location '$BackendDir'; Write-Host 'HireOrbit AI — backend (http://localhost:4000)' -ForegroundColor Cyan; npm run dev"
  $frontendCmd = "Set-Location '$FrontendDir'; Write-Host 'HireOrbit AI — frontend (http://localhost:5173)' -ForegroundColor Cyan; npm run dev"

  Start-Process powershell -ArgumentList '-NoExit', '-Command', $backendCmd  | Out-Null
  Start-Sleep -Seconds 2
  Start-Process powershell -ArgumentList '-NoExit', '-Command', $frontendCmd | Out-Null

  Ok 'backend window:  http://localhost:4000 (health: /healthz, ready: /ready)'
  Ok 'frontend window: http://localhost:5173'
  Write-Host ''
  Write-Host 'Close those terminals to stop the servers.' -ForegroundColor DarkGray
  Write-Host 'Re-run this script anytime — every step is idempotent.' -ForegroundColor DarkGray
}

} finally {
  Pop-Location
}
