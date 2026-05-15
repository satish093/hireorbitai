# HireOrbit AI — Hostinger VPS deployment

This is the single source of truth for putting HireOrbit AI on a Hostinger KVM1 VPS behind CloudPanel. It assumes a fresh box with Ubuntu 22.04 LTS and root access.

## 0. What you're deploying

| Layer      | Stack                                               |
| ---------- | --------------------------------------------------- |
| Frontend   | Vite + React, static build served by Nginx          |
| Backend    | Node 22 + Express + TypeScript, PM2 + Nginx reverse |
| DB / Auth  | Self-hosted PostgreSQL on the VPS                   |
| File store | Local filesystem under `UPLOADS_DIR`                |
| Sessions   | Backend-issued JWT (access) + bcrypt-hashed refresh |
| Email      | Brevo v3 REST API                                   |
| LLM        | Anthropic Claude API                                |

Nothing is hosted off-box except Brevo (email) and Anthropic (LLM). No managed Auth, no managed storage, no third-party Postgres.

## 1. VPS prep (one-time, as root)

```bash
apt update && apt -y upgrade
apt -y install ca-certificates curl gnupg

# CloudPanel — see https://www.cloudpanel.io/docs/v2/getting-started/
curl -sSL https://installer.cloudpanel.io/ce/v2/install.sh -o install.sh
bash install.sh

# Node 22 (NodeSource)
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt -y install nodejs
npm i -g pm2

# Postgres 16 (or use CloudPanel's bundled installer)
apt -y install postgresql postgresql-contrib
systemctl enable --now postgresql
```

Create the application database + role (run as `postgres`):

```bash
sudo -iu postgres psql <<'SQL'
CREATE ROLE hireorbitai WITH LOGIN PASSWORD 'change-me-now';
CREATE DATABASE hireorbitai OWNER hireorbitai;
\c hireorbitai
CREATE EXTENSION IF NOT EXISTS pgcrypto;
SQL
```

In CloudPanel UI:

1. **Sites → Create Node.js site** for `api.hireorbitai.com` (or use a single domain and proxy `/api/*` to Node).
2. **Sites → Create Static site** for `hireorbitai.com` — this is where the Vite build lands.
3. **Let's Encrypt** for both hostnames.
4. **SSH keys**: add yours so you can `ssh hireorbitai@<host>`.

## 2. Email (Brevo) — one-time

Every transactional email — invitations, welcome+temp password, password reset, password changed, account locked — goes through Brevo's v3 REST API. Nothing else sends mail.

1. Sign up at brevo.com.
2. **Senders & Domains → Domain → Authenticate** for `hireorbitai.com` (SPF + DKIM + DMARC).
3. **SMTP & API → API Keys → Generate** — copy the `xkeysib-…` key into `BREVO_API_KEY`.

## 3. Database schema

```bash
ssh hireorbitai@<host>
cd ~/hireorbitai
export DATABASE_URL="postgres://hireorbitai:<password>@127.0.0.1:5432/hireorbitai"

psql "$DATABASE_URL" -f database/schema.sql
psql "$DATABASE_URL" -f database/auth-hardening.sql
psql "$DATABASE_URL" -f database/admin-user-management.sql
psql "$DATABASE_URL" -f database/feature-flags.sql
# Apply the rest of database/*.sql in alphabetical order, or pick the modules
# you actually use (tasks.sql, messages.sql, training.sql, etc.).
```

`database/schema.sql` is idempotent and creates the canonical tables (including the new `password_hash` column on `public.users` and the `auth_sessions` table). The other files are independent feature migrations.

## 4. Backend deploy

```bash
ssh hireorbitai@<host>
git clone https://github.com/<you>/hireorbitai ~/hireorbitai
cd ~/hireorbitai/backend
cp .env.example .env
nano .env    # fill in DATABASE_URL, JWT_SECRET, STORAGE_URL_SECRET, BREVO_*, etc.

# Create the uploads dir referenced by UPLOADS_DIR and make sure it's owned by
# the user PM2 runs as.
sudo mkdir -p /var/lib/hireorbitai/uploads
sudo chown -R hireorbitai:hireorbitai /var/lib/hireorbitai

npm ci
npm run build
# Set DEFAULT_ADMIN_EMAIL and DEFAULT_ADMIN_PASSWORD (>= 12 chars) in .env
# first — the bootstrap script refuses to run without both. The seeded
# password is armed with must_change_password=true and dies on first login.
npm run bootstrap:admin           # creates the first SUPER_ADMIN

pm2 start ecosystem.config.cjs --env production
pm2 save
pm2 startup    # follow the printed command once, as root
```

PM2 process name: `hireorbit-api`. Logs: `pm2 logs hireorbit-api`. Restart: `pm2 restart hireorbit-api --update-env`.

**Required env vars** (everything else has a default):

```
PORT=4000
NODE_ENV=production
APP_URL=https://hireorbitai.com
CORS_ORIGIN=https://hireorbitai.com
TRUST_PROXY=1

DATABASE_URL=postgres://hireorbitai:CHANGE_ME@127.0.0.1:5432/hireorbitai
DATABASE_SSL=disable

UPLOADS_DIR=/var/lib/hireorbitai/uploads
STORAGE_URL_SECRET=<48 random bytes base64>

JWT_SECRET=<48 random bytes base64>
JWT_ACCESS_TTL_SECONDS=3600
JWT_REFRESH_TTL_SECONDS=2592000

BREVO_API_KEY=xkeysib-...
BREVO_SENDER_EMAIL=noreply@hireorbitai.com
BREVO_SENDER_NAME=HireOrbit AI

ANTHROPIC_API_KEY=sk-ant-...

COOKIE_SECRET=<48 random bytes base64>
```

Generate any random secret with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
```

## 5. Frontend deploy

```bash
ssh hireorbitai@<host>
cd ~/hireorbitai/frontend
cp .env.example .env
nano .env    # set VITE_API_URL=https://hireorbitai.com/api  (or your API subdomain)
npm ci
npm run build
rsync -a --delete dist/ ~/htdocs/hireorbitai.com/
```

The frontend is plain static HTML/JS/CSS — Nginx serves the `~/htdocs/hireorbitai.com/` directory. There's no Node process for the UI.

## 6. Nginx reverse proxy

CloudPanel writes the vhost. For `/api/*` to reach the Node backend on `127.0.0.1:4000`, add this location block to the vhost that serves the static frontend (or, if you split subdomains, mount the backend at the root of `api.hireorbitai.com`):

```nginx
location /api/ {
  proxy_pass         http://127.0.0.1:4000/;
  proxy_http_version 1.1;
  proxy_set_header   Host $host;
  proxy_set_header   X-Real-IP $remote_addr;
  proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header   X-Forwarded-Proto $scheme;
  proxy_read_timeout 65s;
  client_max_body_size 20m;     # cover resume + attachment uploads
}
```

The download endpoint is mounted at `/api/files/:bucket/*` and is **public** (HMAC-signed URLs gate access). No special Nginx config required.

## 7. Smoke tests

```bash
curl -sSI https://hireorbitai.com/                              # 200 / index.html
curl -sS  https://hireorbitai.com/api/healthz                   # {"ok":true}
curl -sS  https://hireorbitai.com/api/ready                     # {"ok":true,"db":"reachable"}
curl -sS -X POST https://hireorbitai.com/api/auth/login \
     -H 'Content-Type: application/json' \
     -d '{"email":"<DEFAULT_ADMIN_EMAIL>","password":"<DEFAULT_ADMIN_PASSWORD>"}'
```

Sign in once with the default admin, rotate the password through `/change-password`, then start inviting users.

## 8. Routine maintenance

```bash
# Backend rebuild + restart
bash scripts/deploy.sh backend

# Frontend rebuild + publish
bash scripts/deploy.sh frontend

# Both (default)
bash scripts/deploy.sh

# Daily DB backup (cron)
0 3 * * * pg_dump "$DATABASE_URL" | gzip > /home/hireorbitai/backups/db-$(date +\%F).sql.gz

# Purge expired password-reset tokens (cron, weekly)
0 4 * * 0 psql "$DATABASE_URL" -c "SELECT public.purge_expired_password_reset_tokens()"
```

Uploads live on disk under `UPLOADS_DIR` — back them up with `rsync` or restic on the same cadence as your DB.

## 9. Secret rotation

| Secret                  | What rotating it does                                                    |
| ----------------------- | ------------------------------------------------------------------------ |
| `JWT_SECRET`            | Invalidates every live access token immediately.                         |
| `STORAGE_URL_SECRET`    | Invalidates every signed download URL minted so far.                     |
| `COOKIE_SECRET`         | Invalidates any signed cookie state (rarely used).                       |
| `BREVO_API_KEY`         | Pause email delivery until the new key is wired into `.env`.             |
| `ANTHROPIC_API_KEY`     | AI features start returning 5xx until the new key lands.                 |
| `DATABASE_URL` password | Update the role in `psql` first, then update `.env`, then `pm2 restart`. |

After rotating any of the JWT / cookie / storage secrets, `pm2 restart hireorbit-api --update-env`. To force a global re-login on top, `TRUNCATE public.auth_sessions` and bump `session_version` on every user row.

## 10. Production checklist

- [ ] DNS A record for `hireorbitai.com` → VPS IP.
- [ ] DNS A record for `api.hireorbitai.com` (if using a split subdomain) → same IP.
- [ ] Let's Encrypt active on both hostnames.
- [ ] Brevo domain authenticated (SPF + DKIM + DMARC).
- [ ] Postgres `pg_hba.conf` denies password auth from public; only `127.0.0.1` for the app role.
- [ ] `JWT_SECRET`, `STORAGE_URL_SECRET`, `COOKIE_SECRET` are unique 48-byte random values.
- [ ] `UPLOADS_DIR` owned by the same user PM2 runs as.
- [ ] Daily `pg_dump` cron + offsite copy.
- [ ] `pm2 startup` survived a reboot test (`reboot` then verify the API is back).
- [ ] First admin logged in, rotated the temp password, invited the real ops team.
