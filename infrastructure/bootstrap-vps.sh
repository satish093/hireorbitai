#!/usr/bin/env bash
# =============================================================================
# HireOrbit AI — fresh-VPS bootstrap (Hostinger KVM + Ubuntu 22.04 LTS).
#
# Run ONCE on a brand-new VPS as root, before the first deploy. Idempotent:
# re-running is safe — every step skips work that's already done.
#
#   curl -fsSL https://raw.githubusercontent.com/<you>/hireorbitai/main/infrastructure/bootstrap-vps.sh \
#     | sudo APP_USER=hireorbitai DB_PASSWORD=<pick-one> bash
#
# Or copy locally:
#   sudo bash infrastructure/bootstrap-vps.sh
#
# What it does:
#   1. apt update + base packages
#   2. NodeSource Node 22 LTS + PM2
#   3. PostgreSQL 16 (Ubuntu's bundled package)
#   4. App OS user (creates ~/htdocs, ~/backups, /var/lib/hireorbitai)
#   5. Postgres role + DB
#   6. UFW basics (22, 80, 443)
#
# Does NOT do:
#   - Install CloudPanel (run the official installer separately; this script
#     plays nicely either before or after).
#   - Issue SSL certificates (CloudPanel handles Let's Encrypt).
#   - Clone the app repo / run the build (use scripts/deploy.sh from the
#     application user after CloudPanel + SSH keys are in place).
# =============================================================================
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "✗ run as root (sudo bash $0)" >&2
  exit 1
fi

APP_USER="${APP_USER:-hireorbitai}"
APP_DB="${APP_DB:-hireorbitai}"
DB_PASSWORD="${DB_PASSWORD:-}"
UPLOADS_DIR="${UPLOADS_DIR:-/var/lib/hireorbitai/uploads}"

if [[ -z "$DB_PASSWORD" ]]; then
  echo "✗ DB_PASSWORD env var required (the Postgres role's password)" >&2
  exit 1
fi

log() { printf '\n→ %s\n' "$*"; }
skip() { printf '  (skip) %s\n' "$*"; }

# ---- 1. base packages -------------------------------------------------------
log "apt: update + base packages"
DEBIAN_FRONTEND=noninteractive apt-get -qq update
DEBIAN_FRONTEND=noninteractive apt-get -qq -y install \
  ca-certificates curl gnupg ufw rsync git wget unzip

# ---- 2. Node 22 + PM2 -------------------------------------------------------
if ! command -v node >/dev/null 2>&1 || ! node -v | grep -q '^v22'; then
  log "node: install Node 22 LTS via NodeSource"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  DEBIAN_FRONTEND=noninteractive apt-get -qq -y install nodejs
else
  skip "node $(node -v) already installed"
fi
if ! command -v pm2 >/dev/null 2>&1; then
  log "pm2: install globally"
  npm install -g pm2 >/dev/null
else
  skip "pm2 already installed ($(pm2 -v))"
fi

# ---- 3. PostgreSQL ----------------------------------------------------------
if ! command -v psql >/dev/null 2>&1; then
  log "postgres: install + enable"
  DEBIAN_FRONTEND=noninteractive apt-get -qq -y install postgresql postgresql-contrib
  systemctl enable --now postgresql
else
  skip "postgres already installed ($(psql --version))"
fi

# ---- 4. App OS user ---------------------------------------------------------
if ! id "$APP_USER" >/dev/null 2>&1; then
  log "user: create '$APP_USER' with home dir"
  adduser --disabled-password --gecos "" "$APP_USER"
else
  skip "user '$APP_USER' already exists"
fi
mkdir -p "/home/$APP_USER/htdocs" "/home/$APP_USER/backups" "$UPLOADS_DIR"
chown -R "$APP_USER:$APP_USER" "/home/$APP_USER/htdocs" "/home/$APP_USER/backups"
mkdir -p "$(dirname "$UPLOADS_DIR")"
chown -R "$APP_USER:$APP_USER" "$(dirname "$UPLOADS_DIR")"

# ---- 5. Postgres role + DB --------------------------------------------------
log "postgres: ensure role + db for '$APP_USER'"
sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='$APP_USER'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE ROLE $APP_USER WITH LOGIN PASSWORD '$DB_PASSWORD'"
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='$APP_DB'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE DATABASE $APP_DB OWNER $APP_USER"
sudo -u postgres psql -d "$APP_DB" -c "CREATE EXTENSION IF NOT EXISTS pgcrypto" >/dev/null

# ---- 6. UFW basics ----------------------------------------------------------
if command -v ufw >/dev/null 2>&1; then
  log "ufw: allow OpenSSH + HTTP + HTTPS"
  ufw allow OpenSSH >/dev/null || true
  ufw allow 80/tcp  >/dev/null || true
  ufw allow 443/tcp >/dev/null || true
  yes | ufw enable >/dev/null || true
fi

cat <<EOF

============================================================================
✓ bootstrap complete

  App user:        $APP_USER
  Home dir:        /home/$APP_USER
  Webroot:         /home/$APP_USER/htdocs/hireorbitai.com
  Uploads dir:     $UPLOADS_DIR
  Postgres URL:    postgres://$APP_USER:<DB_PASSWORD>@127.0.0.1:5432/$APP_DB

Next steps:
  1. Install CloudPanel (https://www.cloudpanel.io/docs/v2/getting-started/)
     and create the Nginx sites for hireorbitai.com + api.hireorbitai.com.
  2. Add your SSH key to /home/$APP_USER/.ssh/authorized_keys.
  3. As $APP_USER, clone the repo into ~/hireorbitai:
       ssh $APP_USER@<host>
       git clone https://github.com/<you>/hireorbitai ~/hireorbitai
       cd ~/hireorbitai/backend
       cp .env.example .env       # then fill in real values
       npm ci && npm run build
       npm run bootstrap:admin    # requires DEFAULT_ADMIN_* in .env
       pm2 start ecosystem.config.cjs --env production
       pm2 save && pm2 startup
  4. Drop nginx/hireorbitai.conf.example inside the CloudPanel-generated vhost
     and reload Nginx.
  5. Smoke-test with: bash scripts/healthcheck.sh https://hireorbitai.com
============================================================================
EOF
