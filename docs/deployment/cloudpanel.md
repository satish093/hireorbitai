# Production deployment — Hostinger VPS + CloudPanel

End-to-end guide for putting HireOrbit AI in production on a Hostinger KVM behind CloudPanel. From a clean Ubuntu 22.04 box to a live site in roughly **30 minutes**.

For local development see [local.md](local.md). For day-2 operations (deploys, backups, incidents, rollback) see [production.md](production.md).

---

## Architecture

```
                        ┌──────────────────────────────────────────────┐
                        │              Hostinger KVM (Ubuntu)          │
                        │                                              │
   browser ── HTTPS ──▶ Nginx (CloudPanel)                             │
                        │                                              │
                        │   /              ─▶ Vite dist/ (static)      │
                        │   /api/*         ─▶ 127.0.0.1:4000 (PM2)     │
                        │                                              │
                        │   ┌──────────────────────────────────────┐  │
                        │   │  Node 22 + Express  (hireorbit-api)  │  │
                        │   └─────┬──────────────┬────────────┬────┘  │
                        │         │              │            │       │
                        │         ▼              ▼            ▼       │
                        │   PostgreSQL    /var/lib/uploads   Brevo    │
                        │   (local)       (local FS)        Anthropic │
                        └──────────────────────────────────────────────┘
```

| Layer        | Stack                                                           |
| ------------ | --------------------------------------------------------------- |
| Frontend     | Vite + React static bundle, served by Nginx                     |
| Backend      | Node 22 + Express + TypeScript via PM2 + Nginx reverse proxy    |
| Database     | Self-hosted PostgreSQL 16 on the same VPS                       |
| File storage | Local filesystem under `UPLOADS_DIR`, HMAC-signed download URLs |
| Sessions     | Backend-issued JWT (access) + bcrypt-hashed refresh tokens      |
| Email        | Brevo v3 REST API                                               |
| LLM          | Anthropic Claude                                                |

Nothing is hosted off-box except **Brevo** (email delivery) and **Anthropic** (LLM).

---

## Prerequisites checklist

Before you begin you need:

- [ ] A Hostinger KVM VPS (1 vCPU / 4 GB RAM is sufficient for ≤ 100 active users).
- [ ] Root SSH access to the VPS.
- [ ] DNS for `hireorbitai.com` (and `api.hireorbitai.com` if you split subdomains) pointing at the VPS IP.
- [ ] A Brevo account with the sender domain authenticated (SPF + DKIM + DMARC).
- [ ] An Anthropic API key (if AI features will be enabled).
- [ ] An SSH public key to grant the deploy user.

---

## 1. Provision the VPS (one-time, ~10 min)

### Option A — automated (recommended)

The repo includes an idempotent bootstrap script that installs Node 22, PM2, PostgreSQL 16, creates the application OS user + database, and configures the firewall. Run as root:

```bash
ssh root@<your-vps-ip>
curl -fsSL https://raw.githubusercontent.com/<you>/hireorbitai/main/infrastructure/bootstrap-vps.sh \
  -o /root/bootstrap-vps.sh
chmod +x /root/bootstrap-vps.sh

# DB_PASSWORD is the Postgres role password — pick a strong one.
APP_USER=hireorbitai DB_PASSWORD='choose-a-strong-password' /root/bootstrap-vps.sh
```

Re-running the script is safe; every step skips work that's already done.

### Option B — manual

If you'd rather see every step yourself:

```bash
ssh root@<your-vps-ip>

# System packages
apt update && apt -y upgrade
apt -y install ca-certificates curl gnupg ufw git rsync

# Node 22 LTS via NodeSource
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt -y install nodejs
npm i -g pm2

# PostgreSQL 16
apt -y install postgresql postgresql-contrib
systemctl enable --now postgresql

# Application OS user
adduser --disabled-password --gecos '' hireorbitai
mkdir -p /home/hireorbitai/htdocs /home/hireorbitai/backups /var/lib/hireorbitai/uploads
chown -R hireorbitai:hireorbitai /home/hireorbitai /var/lib/hireorbitai

# Database role + DB
sudo -iu postgres psql <<SQL
CREATE ROLE hireorbitai WITH LOGIN PASSWORD 'choose-a-strong-password';
CREATE DATABASE hireorbitai OWNER hireorbitai;
\c hireorbitai
CREATE EXTENSION IF NOT EXISTS pgcrypto;
SQL

# Firewall
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && yes | ufw enable
```

---

## 2. Install CloudPanel (one-time, ~5 min)

CloudPanel manages Nginx, Let's Encrypt, and the per-site filesystem layout for you.

```bash
# As root on the VPS
curl -sSL https://installer.cloudpanel.io/ce/v2/install.sh -o /root/install-cloudpanel.sh
bash /root/install-cloudpanel.sh
```

The installer prints a URL like `https://<vps-ip>:8443` and a one-time admin password. Open the URL, complete the setup wizard, then create two sites:

| Site type                     | Domain                                         | Document root                              |
| ----------------------------- | ---------------------------------------------- | ------------------------------------------ |
| **Static site**               | `hireorbitai.com` (plus `www.hireorbitai.com`) | `/home/hireorbitai/htdocs/hireorbitai.com` |
| **Node.js site** _(optional)_ | `api.hireorbitai.com`                          | n/a — proxies to `127.0.0.1:4000`          |

The Node.js site is optional. If you'd rather serve everything from one domain, skip it and proxy `/api/*` to `127.0.0.1:4000` from the static site's vhost (instructions in step 5).

For each site, click **SSL/TLS → Actions → Issue Let's Encrypt** to provision the certificate.

Finally, add your SSH public key for the `hireorbitai` user:

```bash
# As root
mkdir -p /home/hireorbitai/.ssh
nano /home/hireorbitai/.ssh/authorized_keys    # paste your public key
chown -R hireorbitai:hireorbitai /home/hireorbitai/.ssh
chmod 700 /home/hireorbitai/.ssh
chmod 600 /home/hireorbitai/.ssh/authorized_keys
```

---

## 3. Brevo (transactional email) — one-time

Every email the app sends — invitations, welcome with temp password, password reset, password changed, account locked — routes through Brevo.

1. Sign up at https://brevo.com.
2. **Senders & Domains → Authenticate** the domain you'll send from (typically `hireorbitai.com`). Add the SPF, DKIM, and DMARC TXT records Brevo gives you to your DNS. Wait until all three turn green.
3. **SMTP & API → API Keys → Generate** a v3 API key starting with `xkeysib-`. Save it for the `BREVO_API_KEY` env var.

> **Important.** Until the domain shows green on all three records, Brevo will route mail to spam folders. Verify before going live.

---

## 4. Deploy the application (~10 min)

SSH in as the application user:

```bash
ssh hireorbitai@<your-vps-ip>
git clone git@github.com:satish093/hireorbitai.git ~/hireorbitai
cd ~/hireorbitai
```

Because the repository is private, configure a read-only GitHub deploy key for
the VPS first; see [auto-deploy.md](auto-deploy.md#3-give-the-vps-its-own-github-deploy-key).

### 4.1 Apply the database schema

```bash
export DATABASE_URL='postgres://hireorbitai:<password-you-set>@127.0.0.1:5432/hireorbitai'

# One file does the whole baseline (recommended for fresh installs):
psql "$DATABASE_URL" -f database/init.sql

# Future schema changes use the migration runner (see backend/migrations/README.md):
cd backend && npm run migrate:up
cd ..
```

`database/init.sql` is the consolidated baseline — every per-feature SQL file concatenated in dependency order. Idempotent and safe to re-run. To regenerate after editing any individual source file, run `npm run db:build-init` from the repo root.

<details>
<summary>Or apply individual files (advanced / partial installs)</summary>

```bash
# Baseline (order matters):
psql "$DATABASE_URL" -f database/schema.sql
psql "$DATABASE_URL" -f database/auth-hardening.sql
psql "$DATABASE_URL" -f database/admin-user-management.sql
psql "$DATABASE_URL" -f database/feature-flags.sql

# Feature modules (any order, idempotent):
for f in database/{tasks,messages,training,user-groups-and-presence,user-activity-tracking}.sql; do
  [ -f "$f" ] && psql "$DATABASE_URL" -f "$f"
done
```

</details>

### 4.2 Configure backend environment

```bash
cd backend
cp .env.example .env
nano .env
```

**Required values** (everything else has a sensible default):

```env
PORT=4000
NODE_ENV=production
APP_URL=https://hireorbitai.com
CORS_ORIGIN=https://hireorbitai.com
FRONTEND_URL=https://hireorbitai.com
TRUST_PROXY=1

DATABASE_URL=postgres://hireorbitai:<password>@127.0.0.1:5432/hireorbitai
DATABASE_SSL=disable

UPLOADS_DIR=/var/lib/hireorbitai/uploads
STORAGE_URL_SECRET=<48 random bytes base64>
JWT_SECRET=<48 random bytes base64>
COOKIE_SECRET=<48 random bytes base64>

BREVO_API_KEY=xkeysib-<your-key>
BREVO_SENDER_EMAIL=noreply@hireorbitai.com
BREVO_SENDER_NAME=HireOrbit AI

ANTHROPIC_API_KEY=sk-ant-<your-key>

# For the first admin only — required by npm run bootstrap:admin
DEFAULT_ADMIN_EMAIL=founder@hireorbitai.com
DEFAULT_ADMIN_PASSWORD=<temporary password, >= 12 chars>
```

Generate each random secret with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
```

### 4.3 Build + start

```bash
# From the repo root
cd ~/hireorbitai
npm install              # populates shared/ + backend/ + frontend/ via workspaces
npm run shared:build     # compiles @hireorbitai/shared

# Backend
cd backend
npm run build
npm run bootstrap:admin  # provisions the first SUPER_ADMIN

pm2 start ecosystem.config.cjs --env production
pm2 save
pm2 startup              # follow the printed `sudo ...` command once

# Frontend
cd ../frontend
cp .env.example .env
# Set VITE_API_URL=https://hireorbitai.com/api  (or your api. subdomain)
npm run build
rsync -a --delete dist/ /home/hireorbitai/htdocs/hireorbitai.com/
```

PM2 process name is `hireorbit-api`. Useful PM2 commands:

```bash
pm2 logs hireorbit-api                # tail logs
pm2 restart hireorbit-api --update-env # reload after .env changes
pm2 monit                              # interactive dashboard
```

---

## 5. Wire `/api` through Nginx

If you used a **single-domain** deployment (everything under `hireorbitai.com`), proxy `/api/*` to the Node backend. The repo ships an example snippet at [`nginx/hireorbitai.conf.example`](../../nginx/hireorbitai.conf.example).

Add this **inside the existing HTTPS `server { … }` block** that CloudPanel generated for the site — **do not replace the file**, CloudPanel regenerates it on cert renewal:

```nginx
location /api/ {
  proxy_pass         http://127.0.0.1:4000/;
  proxy_http_version 1.1;
  proxy_set_header   Host $host;
  proxy_set_header   X-Real-IP $remote_addr;
  proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header   X-Forwarded-Proto $scheme;
  proxy_read_timeout 65s;
  proxy_send_timeout 65s;
  client_max_body_size 20m;        # covers resume + task-attachment uploads
}
```

For **split-domain** deployments (separate `api.hireorbitai.com`), the entire vhost root is the proxy block — CloudPanel's Node.js site template handles this automatically.

After editing, reload Nginx:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

The download endpoint at `/api/files/:bucket/*` is **public by URL** (HMAC-signed expiring links). No additional Nginx config is required.

---

## 6. Smoke test

```bash
curl -sSI https://hireorbitai.com/                              # 200 / index.html
curl -sS  https://hireorbitai.com/api/healthz                   # {"ok":true,...}
curl -sS  https://hireorbitai.com/api/ready                     # {"ok":true,"db":"reachable"}

bash scripts/healthcheck.sh https://hireorbitai.com             # full probe matrix
```

Sign in with the credentials from §4.2 (`DEFAULT_ADMIN_EMAIL` / `DEFAULT_ADMIN_PASSWORD`). The app routes you to `/change-password` immediately — rotate the password before doing anything else. The seeded password becomes unusable the moment you rotate.

---

## 7. Production checklist

Before considering the deployment live:

- [ ] DNS A records for `hireorbitai.com` (and `api.hireorbitai.com` if split) point at the VPS IP.
- [ ] Let's Encrypt active on both hostnames; CloudPanel auto-renewal verified.
- [ ] Brevo domain authenticated — all three records (SPF, DKIM, DMARC) green.
- [ ] Postgres `pg_hba.conf` allows password auth only from `127.0.0.1` for the app role.
- [ ] `JWT_SECRET`, `STORAGE_URL_SECRET`, `COOKIE_SECRET` are unique 48-byte random values.
- [ ] `UPLOADS_DIR` exists and is owned by the user PM2 runs as.
- [ ] Daily backup cron scheduled — see [production.md](production.md).
- [ ] `pm2 save && pm2 startup` survived a `reboot` test.
- [ ] The first admin's seeded password has been rotated through `/change-password`.
- [ ] `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS` are sized for your expected load.
- [ ] You can reach the API from your laptop: `curl https://hireorbitai.com/api/healthz`.

---

## 8. Secret rotation policy

| Secret                  | Effect of rotating                                    | Action required                                                                                 |
| ----------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `JWT_SECRET`            | Invalidates every live access token immediately.      | `pm2 restart hireorbit-api --update-env`; users re-log-in.                                      |
| `STORAGE_URL_SECRET`    | Every existing signed download URL stops working.     | `pm2 restart` — new URLs are minted on next page load.                                          |
| `COOKIE_SECRET`         | Invalidates any signed cookie state.                  | `pm2 restart`.                                                                                  |
| `BREVO_API_KEY`         | Pauses email delivery until the new key is in `.env`. | Update key in `.env`, `pm2 restart`.                                                            |
| `ANTHROPIC_API_KEY`     | AI features start returning 5xx.                      | Update key in `.env`, `pm2 restart`.                                                            |
| `DATABASE_URL` password | API can't read/write the database.                    | Update the role with `ALTER ROLE ... WITH PASSWORD ...` first, then `.env`, then `pm2 restart`. |

To force a global re-login on top of a JWT secret rotation, run:

```sql
TRUNCATE public.auth_sessions;
UPDATE public.users SET session_version = session_version + 1;
```

---

## 9. PM2 cluster mode (optional)

The default config runs one PM2 worker. To scale across CPU cores once you outgrow that:

```bash
PM2_INSTANCES=max pm2 restart hireorbit-api --update-env
```

The `PM2_INSTANCES` env var is read by [`backend/ecosystem.config.cjs`](../../backend/ecosystem.config.cjs). It flips `exec_mode` from `fork` to `cluster` automatically when set above 1. Concurrency-safety per component is documented inline in that file.

The in-process job scheduler is leader-elected — only the worker with `NODE_APP_INSTANCE === '0'` fires jobs, so cluster mode doesn't multiply the reminder cron.

---

## 10. What's next

- Push-to-deploy (auto-deploy on every `git push` to `main`) → [auto-deploy.md](auto-deploy.md)
- Day-2 operations: deploys, backups, restore, incident playbooks → [production.md](production.md)
- System design: layered architecture, query builder, auth flow → [../architecture.md](../architecture.md)
- API contract: endpoint shapes, status codes, rate-limit tiers → [../api-conventions.md](../api-conventions.md)
- Branching + release flow → [../branching.md](../branching.md)
