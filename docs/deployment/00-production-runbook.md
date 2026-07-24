# Production Runbook — Fresh Start & Full Reset

One document covering both production scenarios:

- **Scenario A** → Deploy to a brand-new VPS for the first time (no data yet)
- **Scenario B** → Wipe all existing data on a live VPS and start completely clean

Both scenarios end with a working production app at `https://hireorbitai.com`.

---

## Prerequisites (both scenarios)

- SSH access to the VPS (Hostinger) as the CloudPanel site user
- CloudPanel web UI access (to create/manage the site and database)
- `hireorbitai.com` A record pointing to the VPS IP
- A GitHub account with access to the `satish093/hireorbitai` repo
- Your `ANTHROPIC_API_KEY` (for AI features) and `BREVO_API_KEY` (for email)
- `BREVO_SENDER_EMAIL` verified in your Brevo account

---

## Scenario A — Fresh Deployment on a New VPS

### A1. Create the site in CloudPanel

CloudPanel UI → **Sites → Add Site → Node.js**:

| Field           | Value             |
| --------------- | ----------------- |
| Domain name     | `hireorbitai.com` |
| Node.js version | **22**            |
| App port        | `4000`            |
| Site user       | `hireorbitai`     |

CloudPanel creates:

- Linux user `hireorbitai` with home `/home/hireorbitai/`
- Web root at `/home/hireorbitai/htdocs/hireorbitai.com`
- Nginx vhost (SSL via Let's Encrypt — activate in CloudPanel → Domains → SSL)

### A2. Add the GitHub deploy key

On the VPS as `hireorbitai`:

```bash
ssh-keygen -t ed25519 -C "hireorbitai-vps-deploy" -f ~/.ssh/deploy_key -N ""
cat ~/.ssh/deploy_key.pub
```

Copy the printed public key → GitHub → repo → **Settings → Deploy keys → Add deploy key**
(name: `VPS deploy`, read-only: yes).

Then tell SSH to use it for GitHub:

```bash
cat >> ~/.ssh/config << 'EOF'
Host github.com
  IdentityFile ~/.ssh/deploy_key
  StrictHostKeyChecking accept-new
EOF
```

### A3. Clone the repo

```bash
cd ~
git clone git@github.com:satish093/hireorbitai.git hireorbitai
cd ~/hireorbitai
npm install --no-audit --no-fund
npm run shared:build
```

### A4. Create the production database

Via CloudPanel UI → **Databases → Add Database**:

| Field         | Value                 |
| ------------- | --------------------- |
| Database name | `hireorbit_prod`      |
| Database user | `hireorbit_prod_user` |
| Password      | (copy and keep it)    |

Or on the VPS via psql:

```bash
sudo -u postgres psql <<'SQL'
CREATE ROLE hireorbit_prod_user WITH LOGIN PASSWORD 'STRONG_PASSWORD_HERE';
CREATE DATABASE hireorbit_prod OWNER hireorbit_prod_user;
\connect hireorbit_prod
GRANT ALL ON SCHEMA public TO hireorbit_prod_user;
SQL
```

### A5. Create the backend `.env`

```bash
cp ~/hireorbitai/backend/.env.production.example ~/hireorbitai/backend/.env
nano ~/hireorbitai/backend/.env
```

Fill in every `REPLACE_ME` value. The three secrets must be 48+ random bytes each:

```bash
# Run this 3× to generate JWT_SECRET, COOKIE_SECRET, STORAGE_URL_SECRET:
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
```

Key values to set:

```ini
DATABASE_URL=postgres://hireorbit_prod_user:STRONG_PASSWORD_HERE@127.0.0.1:5432/hireorbit_prod
DATABASE_SSL=disable
DB_GUARD=enforce

APP_URL=https://hireorbitai.com
CORS_ORIGIN=https://hireorbitai.com
FRONTEND_URL=https://hireorbitai.com

UPLOADS_DIR=/var/lib/hireorbitai/uploads

ANTHROPIC_API_KEY=sk-ant-REPLACE_ME
BREVO_API_KEY=xkeysib-REPLACE_ME
BREVO_SENDER_EMAIL=noreply@hireorbitai.com
```

### A6. Create the uploads directory

```bash
sudo mkdir -p /var/lib/hireorbitai/uploads
sudo chown -R hireorbitai:hireorbitai /var/lib/hireorbitai
```

### A7. Load the schema + run migrations

```bash
cd ~/hireorbitai
set -a; source backend/.env; set +a

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/init.sql
npm --prefix backend run migrate:up
```

### A8. First build + PM2 start

```bash
cd ~/hireorbitai
npm --prefix backend run build
npm --prefix frontend run build

# Publish the frontend SPA
rsync -a --delete frontend/dist/ ~/htdocs/hireorbitai.com/

# Start the API under PM2 (name MUST be hireorbitai-api — update.sh uses this)
pm2 start backend/ecosystem.config.cjs --env production
pm2 save
pm2 startup    # follow the printed sudo command so PM2 survives reboots
```

### A9. Seed the first SUPER_ADMIN

```bash
cd ~/hireorbitai
npm --prefix backend run bootstrap:admin
# Follow the prompts: enter email + password for the first admin account
```

### A10. Configure Nginx in CloudPanel

CloudPanel → your site → **Vhost** → paste these blocks inside the `server { }`:

```nginx
# API → Node (port 4000)
location /api/ {
    proxy_pass         http://127.0.0.1:4000;
    proxy_http_version 1.1;
    proxy_set_header   Upgrade    $http_upgrade;
    proxy_set_header   Connection "upgrade";
    proxy_set_header   Host       $host;
    proxy_set_header   X-Real-IP  $remote_addr;
    proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto $scheme;
    proxy_buffering    off;   # required for SSE / realtime stream
    proxy_read_timeout 120s;
}

# SPA fallback — serve index.html for all unknown paths
location / {
    root  /home/hireorbitai/htdocs/hireorbitai.com;
    try_files $uri $uri/ /index.html;
}
```

Save & reload Nginx.

### A11. Wire up GitHub Actions deploy

In GitHub → repo → **Settings → Secrets → Actions**, add:

| Secret           | Value                                                                            |
| ---------------- | -------------------------------------------------------------------------------- |
| `DEPLOY_HOST`    | VPS IP or hostname                                                               |
| `DEPLOY_USER`    | `hireorbitai`                                                                    |
| `DEPLOY_PORT`    | `22`                                                                             |
| `DEPLOY_SSH_KEY` | private key (`~/.ssh/deploy_key`) — full content including `-----BEGIN/END-----` |

Copy the private key from the VPS:

```bash
cat ~/.ssh/deploy_key    # copy ALL of this into DEPLOY_SSH_KEY
```

### A12. Smoke test

```bash
# From the VPS or your local machine:
curl -fsS https://hireorbitai.com/api/health
# → {"ok":true}

curl -o /dev/null -w '%{http_code}' https://hireorbitai.com/api/auth/me
# → 401  (proves auth middleware is alive)
```

Production is live. Future deploys happen automatically on every push to `main` via
`.github/workflows/deploy-production.yml`.

---

## Scenario B — Wipe All Data & Start Fresh (Existing VPS)

> ⚠️ **This erases ALL production data permanently.** Run a backup first.
> Use this when you want a completely clean slate — e.g. removing pilot/test data
> before the real go-live.

### B1. Take a full backup first

```bash
cd ~/hireorbitai
bash scripts/backup.sh
# Prints something like: ✓ backup complete → /home/hireorbitai/backups/20260524-143200/
# Keep the timestamp — you'll need it if you need to roll back.
```

### B2. Run the production reset script

```bash
cd ~/hireorbitai
CONFIRM=ERASE-PRODUCTION bash scripts/reset-prod.sh --i-understand
```

The script will:

1. Verify all safety gates (env var, argument, DB name, backup)
2. Ask you to **type the database name** (`hireorbit_prod`) to confirm
3. Drop and rebuild the entire schema (`DROP SCHEMA public CASCADE`)
4. Load `database/init.sql` (full schema)
5. Run all migrations (`migrate:up`)
6. Move old uploads aside to `uploads.pre-reset.<stamp>/`
7. Restart PM2 and curl `/api/health`

### B3. Seed the first SUPER_ADMIN

After the reset, no users exist. Create the first admin:

```bash
cd ~/hireorbitai
npm --prefix backend run bootstrap:admin
```

Or, to do the reset + admin seed in one command:

```bash
CONFIRM=ERASE-PRODUCTION SEED_ADMIN=true bash scripts/reset-prod.sh --i-understand
```

### B4. Verify clean state

```bash
# API is healthy
curl -fsS https://hireorbitai.com/api/health
# → {"ok":true}

# Database has only the schema (no old rows)
set -a; source ~/hireorbitai/backend/.env; set +a
psql "$DATABASE_URL" -c "SELECT count(*) FROM public.users;"
# → count = 0  (or 1 if you seeded an admin)
```

### If the reset fails — rollback

The backup taken in B1 can be restored in full:

```bash
bash scripts/restore.sh <stamp-from-B1> all --force
pm2 restart hireorbitai-api --update-env
```

---

## Post-reset: Reconnect GitHub Actions

The existing GitHub secrets (`DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_PORT`,
`DEPLOY_SSH_KEY`) remain valid after a data reset — no changes needed. The next
push to `main` will deploy normally.

---

## Quick reference — ongoing production commands

```bash
# Watch live logs
pm2 logs hireorbitai-api --lines 100

# Restart without a deploy
pm2 restart hireorbitai-api --update-env

# Manual deploy (same as what GitHub Actions runs)
cd ~/hireorbitai && bash scripts/update.sh

# Apply a new migration manually
cd ~/hireorbitai
set -a; source backend/.env; set +a
npm --prefix backend run migrate:up

# Take a backup at any time
cd ~/hireorbitai && bash scripts/backup.sh

# Health check
bash scripts/healthcheck.sh https://hireorbitai.com
```

---

→ Detailed per-topic guides: [VPS setup](01-vps-cloudpanel.md) · [Databases](02-databases.md) ·
[GitHub Actions](04-github-actions.md) · [Deploy & rollback](05-deploy-and-rollback.md) ·
[Full reset reference](06-fresh-reset.md)
