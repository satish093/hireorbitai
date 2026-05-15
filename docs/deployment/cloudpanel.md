# CloudPanel deployment (Hostinger VPS)

This is the **single source of truth** for putting HireOrbit AI on a Hostinger KVM VPS behind CloudPanel. Time-to-running on a fresh Ubuntu 22.04 box: ~30 minutes.

For local development see [local.md](local.md). For incident response see [production.md](production.md).

```
                          ┌─────────────────────────────────────┐
                          │           Hostinger KVM1            │
                          │                                     │
   browser ─── 443 ──►   Nginx (CloudPanel) ──► Vite dist/      │
                          │                                     │
                          │                ╲── /api/* ──► PM2: hireorbit-api
                          │                                     │
                          │                                ╲── PostgreSQL
                          │                                ╲── /var/lib/hireorbitai/uploads
                          └─────────────────────────────────────┘
```

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

Nothing is hosted off-box except Brevo (email) and Anthropic (LLM).

## 1. VPS prep (one-time, as root)

```bash
apt update && apt -y upgrade
apt -y install ca-certificates curl gnupg

# CloudPanel CE installer — see https://www.cloudpanel.io/docs/v2/getting-started/
curl -sSL https://installer.cloudpanel.io/ce/v2/install.sh -o install.sh
bash install.sh

# Node 22 via NodeSource
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt -y install nodejs
npm i -g pm2

# Postgres 16 (or 14+; CloudPanel can also install one for you)
apt -y install postgresql postgresql-contrib
systemctl enable --now postgresql
```

Create the application database + role:

```bash
sudo -iu postgres psql <<'SQL'
CREATE ROLE hireorbitai WITH LOGIN PASSWORD 'change-me-now';
CREATE DATABASE hireorbitai OWNER hireorbitai;
\c hireorbitai
CREATE EXTENSION IF NOT EXISTS pgcrypto;
SQL
```

In **CloudPanel UI**:

1. **Sites → Create Node.js site** for `api.hireorbitai.com` (or use one domain and proxy `/api/*` to Node — both supported).
2. **Sites → Create Static site** for `hireorbitai.com` — Vite's `dist/` lands here.
3. **Let's Encrypt** for both hostnames.
4. **SSH keys**: add yours.

## 2. Email (Brevo) — one-time

Every transactional email path (invitation, welcome+temp password, password reset, password changed, account locked) goes through Brevo. Nothing else sends mail.

1. Sign up at brevo.com.
2. **Senders & Domains → Authenticate** for `hireorbitai.com` (SPF + DKIM + DMARC).
3. **SMTP & API → API Keys → Generate** — copy the `xkeysib-…` key into `BREVO_API_KEY`.

## 3. Clone + first build

```bash
ssh hireorbitai@<host>
git clone https://github.com/<you>/hireorbitai ~/hireorbitai
cd ~/hireorbitai

# Apply the database schema. The bash helper handles idempotency + ordering.
export DATABASE_URL="postgres://hireorbitai:<password>@127.0.0.1:5432/hireorbitai"
psql "$DATABASE_URL" -f database/schema.sql
psql "$DATABASE_URL" -f database/auth-hardening.sql
psql "$DATABASE_URL" -f database/admin-user-management.sql
psql "$DATABASE_URL" -f database/feature-flags.sql
# Apply other feature modules as needed (tasks.sql, training.sql, messages.sql, …)

# Backend env
cd backend
cp .env.example .env
nano .env    # fill in DATABASE_URL, JWT_SECRET, STORAGE_URL_SECRET, BREVO_*, etc.

# Uploads directory (UPLOADS_DIR), owned by the PM2 user
sudo mkdir -p /var/lib/hireorbitai/uploads
sudo chown -R hireorbitai:hireorbitai /var/lib/hireorbitai

npm ci
npm run build

# Bootstrap the first admin. Set DEFAULT_ADMIN_EMAIL + DEFAULT_ADMIN_PASSWORD
# (>= 12 chars) in .env BEFORE running this; the script refuses without both.
npm run bootstrap:admin

pm2 start ecosystem.config.cjs --env production
pm2 save
pm2 startup    # follow the printed `sudo` command once

# Frontend
cd ../frontend
cp .env.example .env
nano .env    # VITE_API_URL=https://hireorbitai.com/api  (or your api. subdomain)
npm ci
npm run build
rsync -a --delete dist/ ~/htdocs/hireorbitai.com/
```

## 4. Nginx wiring

CloudPanel writes the static-site vhost for you. To proxy `/api/*` to the Node backend on `127.0.0.1:4000`, drop the snippet from [`nginx/hireorbitai.conf.example`](../../nginx/hireorbitai.conf.example) inside the existing `server { … }` block. **Don't replace** the CloudPanel-generated config; just add the `location /api/` block.

```nginx
location /api/ {
  proxy_pass         http://127.0.0.1:4000/;
  proxy_http_version 1.1;
  proxy_set_header   Host $host;
  proxy_set_header   X-Real-IP $remote_addr;
  proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header   X-Forwarded-Proto $scheme;
  proxy_read_timeout 65s;
  client_max_body_size 20m;     # resume + attachment uploads
}
```

The download endpoint at `/api/files/:bucket/*` is **public** (HMAC-signed expiring URLs gate access). No special config required.

After editing, reload Nginx:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

## 5. Required env vars (backend)

The full list is in [`backend/.env.example`](../../backend/.env.example). The minimum to boot:

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
COOKIE_SECRET=<48 random bytes base64>

BREVO_API_KEY=xkeysib-...
ANTHROPIC_API_KEY=sk-ant-...
```

Generate any secret with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
```

## 6. Smoke test

```bash
curl -sSI https://hireorbitai.com/                              # 200 / index.html
curl -sS  https://hireorbitai.com/api/healthz                   # {"ok":true,...}
curl -sS  https://hireorbitai.com/api/ready                     # {"ok":true,"db":"reachable"}
bash scripts/healthcheck.sh https://hireorbitai.com             # full curl matrix
```

Sign in with the admin you bootstrapped, rotate the password, then invite the rest of the team.

## 7. Day-2 ops

```bash
bash scripts/update.sh              # git pull + build + pm2 restart + smoke
bash scripts/backup.sh              # pg_dump + uploads tarball under ~/backups
bash scripts/restore.sh <stamp>     # restore from a specific backup stamp
bash scripts/healthcheck.sh         # red/green/yellow status across endpoints
pm2 logs hireorbit-api              # tail the Node process
pm2 restart hireorbit-api --update-env   # reload after .env changes
```

Schedule the backup script as a cron:

```cron
0 3 * * * /home/hireorbitai/hireorbitai/scripts/backup.sh >> /home/hireorbitai/backups/backup.log 2>&1
```

## 8. Production checklist

- [ ] DNS A records for `hireorbitai.com` (and `api.hireorbitai.com` if split) point at the VPS.
- [ ] Let's Encrypt issued for both hostnames; auto-renewal verified in CloudPanel.
- [ ] Brevo domain authenticated (SPF + DKIM + DMARC green).
- [ ] Postgres `pg_hba.conf` denies password auth from public; allows only `127.0.0.1` for the app role.
- [ ] `JWT_SECRET`, `STORAGE_URL_SECRET`, `COOKIE_SECRET` are unique 48-byte random strings.
- [ ] `UPLOADS_DIR` exists and is owned by the same user PM2 runs as.
- [ ] `pm2 save && pm2 startup` survived a `reboot` test.
- [ ] Cron-scheduled `scripts/backup.sh` writes to a dir on a separate disk (or rsync'd offsite).
- [ ] The first admin's seeded password has been rotated through `/change-password`.

## 9. Secret rotation

| Secret                  | Effect of rotating                                                |
| ----------------------- | ----------------------------------------------------------------- |
| `JWT_SECRET`            | Invalidates every live access token immediately.                  |
| `STORAGE_URL_SECRET`    | Invalidates every signed download URL minted so far.              |
| `COOKIE_SECRET`         | Invalidates any signed cookie state.                              |
| `BREVO_API_KEY`         | Pauses email delivery until the new key is in `.env`.             |
| `ANTHROPIC_API_KEY`     | AI features 5xx until the new key lands.                          |
| `DATABASE_URL` password | Update the role in `psql` first, then `.env`, then `pm2 restart`. |

After rotating JWT / cookie / storage secrets, `pm2 restart hireorbit-api --update-env`. To force a global re-login on top, `TRUNCATE public.auth_sessions` and bump `session_version` on every user row.
