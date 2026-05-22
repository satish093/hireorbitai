# HireOrbit AI — Setup Guide

Single-page quickstart covering every environment. For deep dives, see [`docs/deployment/`](docs/deployment/).

---

## Prerequisites

| Tool       | Minimum                    | Check            |
| ---------- | -------------------------- | ---------------- |
| Node.js    | 22.0.0                     | `node --version` |
| npm        | 10+ (bundled with Node 22) | `npm --version`  |
| PostgreSQL | 14+                        | `psql --version` |
| Git        | any                        | `git --version`  |

Node 22 is **hard-required** — the backend uses `--env-file`, `--watch`, and `--import tsx` which are Node 22 built-ins.

---

## 1. Local Development

### Windows (recommended)

```powershell
# Clone and bootstrap in one command:
git clone <repo-url> hireorbitai
cd hireorbitai
.\scripts\dev-windows.ps1
```

The script:

- Checks Node 22 + psql are available
- Copies `.env.example` files and generates secrets automatically
- Runs `npm install` + `npm run shared:build`
- Creates the local Postgres database and applies the full schema
- Bootstraps the first `SUPER_ADMIN` account
- Launches backend (port 4000) and frontend (port 5173) in separate windows

Re-run any time — it is idempotent.

**Credentials on first run:**

- Admin email: `admin@hireorbitai.local`
- Admin password: printed to the terminal (random, save it)

### Linux / macOS

```bash
# 1. Install dependencies
npm install

# 2. Build shared types (required before anything else)
npm run shared:build

# 3. Copy env templates
cp backend/.env.development.example backend/.env
cp frontend/.env.development.example frontend/.env

# 4. Edit backend/.env — fill in DATABASE_URL and JWT_SECRET at minimum

# 5. Apply schema to your local Postgres
node --env-file=backend/.env scripts/reset-dev.mjs --yes

# 6. Bootstrap the first admin account
npm --prefix backend run bootstrap:admin

# 7. Start dev servers (two terminals)
npm --prefix backend run dev      # :4000
npm --prefix frontend run dev     # :5173
```

### Stop local servers (Windows)

```powershell
.\scripts\stop-dev-windows.ps1
```

---

## 2. Environment Files

| File                               | When to copy         | Used by                |
| ---------------------------------- | -------------------- | ---------------------- |
| `backend/.env.example`             | production reference | VPS                    |
| `backend/.env.development.example` | → `backend/.env`     | local dev              |
| `backend/.env.production.example`  | production reference | VPS (rename to `.env`) |
| `frontend/.env.example`            | → `frontend/.env`    | build time             |

**Critical fields in `backend/.env`:**

```bash
NODE_ENV=development
DATABASE_URL=postgres://user:pass@localhost:5432/hireorbit_dev
JWT_SECRET=<random 64-char hex>
COOKIE_SECRET=<random 64-char hex>
STORAGE_URL_SECRET=<random 32-char hex>
UPLOADS_DIR=./uploads-dev
```

Production must have `DATABASE_URL` containing the string `hireorbit_prod` — startup refuses to run otherwise.

---

## 3. Database Setup

### Local (dev)

```bash
# Create DB + apply full schema + run migrations
node --env-file=backend/.env scripts/reset-dev.mjs --yes

# With sample data (seed)
node --env-file=backend/.env scripts/reset-dev.mjs --yes --seed
```

`reset-dev.mjs` has a production guard — it refuses to wipe `hireorbit_prod` or any URL it doesn't recognize as a dev database.

### Production VPS

Migrations are applied manually after each deploy:

```bash
# SSH into the VPS, then:
set -a; source ~/hireorbitai/backend/.env; set +a

# Apply new node-pg-migrate migrations
npm --prefix ~/hireorbitai/backend run migrate:up

# Apply manual SQL files (if added)
psql "$DATABASE_URL" -f ~/hireorbitai/database/<new-file>.sql
```

### Backup / restore

```bash
# Backup (run on VPS)
bash scripts/backup.sh

# Restore from backup stamp
bash scripts/restore.sh <stamp> all --force
```

---

## 4. First Admin Bootstrap

If no admin account exists (fresh VPS or fresh local DB):

```bash
npm --prefix backend run bootstrap:admin
# or with custom credentials:
ENABLE_DEFAULT_ADMIN=true DEFAULT_ADMIN_EMAIL=you@example.com DEFAULT_ADMIN_PASSWORD=Secure123! \
  npm --prefix backend run bootstrap:admin
```

---

## 5. Running the Verify Gate

```bash
# Fast gate (format + types + lint + backend tests) — run before every commit
npm run verify

# Full gate (above + production build + E2E Playwright tests) — run before every deploy
npm run verify:full
```

CI runs `npm run verify` on every push and `npm run verify:full` on `main` and `dev`.

---

## 6. Dev / Staging Hosting (Free Tier)

The `dev` branch auto-deploys to [Render](https://render.com) (free tier) using the `dev.yml` workflow.

| Piece    | Provider      | Notes                                                            |
| -------- | ------------- | ---------------------------------------------------------------- |
| Backend  | Render (free) | web service, spin-down on inactivity                             |
| Frontend | Render (free) | static site                                                      |
| Database | Neon (free)   | serverless Postgres, `DATABASE_URL` must contain `hireorbit_dev` |

**GitHub secrets required for dev auto-deploy:**

| Secret                        | Value                                                                     |
| ----------------------------- | ------------------------------------------------------------------------- |
| `DEV_DATABASE_URL`            | Neon connection string (must contain `hireorbit_dev` or `neon.tech` host) |
| `RENDER_DEPLOY_HOOK_BACKEND`  | Render deploy hook URL for backend service                                |
| `RENDER_DEPLOY_HOOK_FRONTEND` | Render deploy hook URL for frontend service                               |

**Optional (for staging VPS instead of Render):**

| Secret            | Value                 |
| ----------------- | --------------------- |
| `STAGING_HOST`    | staging VPS IP        |
| `STAGING_USER`    | SSH user              |
| `STAGING_SSH_KEY` | private key           |
| `STAGING_PORT`    | SSH port (default 22) |

---

## 7. Production VPS Setup

See `docs/deployment/vps-setup.md` for the full CloudPanel setup guide. Summary:

1. Provision Ubuntu 22.04 VPS (minimum 2 GB RAM)
2. Install CloudPanel, Node 22, PostgreSQL 16, PM2
3. Clone repo to `~/hireorbitai`
4. Copy `backend/.env.production.example` → `backend/.env`, fill in all values
5. Apply schema: `psql "$DATABASE_URL" -f ~/hireorbitai/database/init.sql`
6. Bootstrap admin: `npm --prefix backend run bootstrap:admin`
7. Start with PM2: `pm2 start backend/ecosystem.config.cjs`

---

## 8. CI/CD Secrets Reference

All secrets live at **Settings → Secrets and variables → Actions** in the GitHub repo.

| Secret                        | Required by           | Purpose                                    |
| ----------------------------- | --------------------- | ------------------------------------------ |
| `DEPLOY_HOST`                 | deploy-production.yml | Production VPS IP/hostname                 |
| `DEPLOY_USER`                 | deploy-production.yml | SSH username                               |
| `DEPLOY_PORT`                 | deploy-production.yml | SSH port                                   |
| `DEPLOY_SSH_KEY`              | deploy-production.yml | Private SSH key (full PEM)                 |
| `STAGING_HOST`                | deploy-staging.yml    | Staging VPS IP/hostname (optional)         |
| `STAGING_USER`                | deploy-staging.yml    | Staging SSH username                       |
| `STAGING_SSH_KEY`             | deploy-staging.yml    | Staging private SSH key                    |
| `STAGING_PORT`                | deploy-staging.yml    | Staging SSH port                           |
| `DEV_DATABASE_URL`            | dev.yml               | Neon dev database URL                      |
| `RENDER_DEPLOY_HOOK_BACKEND`  | dev.yml               | Render backend deploy hook                 |
| `RENDER_DEPLOY_HOOK_FRONTEND` | dev.yml               | Render frontend deploy hook                |
| `ZAP_TARGET_URL`              | security-scan.yml     | Staging URL for ZAP scans (never prod)     |
| `ROLLBACK_APPROVED`           | rollback.yml          | Set to `true` before rollback, clear after |

---

## 9. Deployment Flow

```
feature/*  →  PR review  →  dev branch
                                ↓
                        dev.yml: verify:full → migrate dev DB → Render deploy
                                ↓ (promoted manually)
                        deploy-staging.yml: staging VPS (optional)
                                ↓ (PR merged to main)
                        deploy-production.yml: production VPS
```

**To deploy to production:**

```bash
# From your local machine:
git checkout main
git merge --ff-only dev   # or use GitHub PR
git push origin main      # triggers deploy-production.yml
```

---

## 10. Rollback

### Via GitHub Actions (recommended)

1. Find the last-known-good SHA: `git log --oneline -20`
2. Set `ROLLBACK_APPROVED=true` in GitHub secrets
3. Go to **Actions → Rollback deployment → Run workflow**
4. Enter the SHA and choose `production` or `staging`
5. **Clear `ROLLBACK_APPROVED` immediately after** the workflow completes

### Manual VPS fallback

```bash
# SSH into the VPS
ssh user@vps-ip

cd ~/hireorbitai
git log --oneline -10          # find the good SHA
git checkout <good-sha>        # detached HEAD
npm install && npm run build
pm2 reload hireorbitai-api --update-env

# Verify
curl https://hireorbitai.com/api/health
```

---

## 11. Fresh Deploy / Clean Slate

To tear down and rebuild from scratch on the VPS:

```bash
# 1. Drop the production database (DESTRUCTIVE — backup first!)
bash scripts/backup.sh
psql "$DATABASE_URL" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"

# 2. Re-apply the full schema
psql "$DATABASE_URL" -f ~/hireorbitai/database/init.sql

# 3. Apply migrations
npm --prefix ~/hireorbitai/backend run migrate:up

# 4. Re-bootstrap the admin
npm --prefix ~/hireorbitai/backend run bootstrap:admin

# 5. Reload the server
pm2 reload hireorbitai-api
```

---

## 12. Verifying Everything Works

```bash
# 1. Backend health check
bash scripts/healthcheck.sh https://hireorbitai.com
# Expected: all checks green, exit 0

# 2. Backend unit + security tests
npm run verify

# 3. Full gate including E2E
npm run verify:full

# 4. E2E only (quicker iteration)
npm --prefix frontend run test:e2e

# 5. Backend tests only
npm --prefix backend test
```

---

## 13. Detailed Documentation

| Topic                     | Location                                       |
| ------------------------- | ---------------------------------------------- |
| VPS + CloudPanel setup    | `docs/deployment/vps-setup.md`                 |
| Database setup            | `docs/deployment/database.md`                  |
| Render hosting            | `docs/deployment/render.md`                    |
| GitHub Actions            | `docs/deployment/github-actions.md`            |
| Deployment steps          | `docs/deployment/deployment.md`                |
| Rollback procedure        | `docs/deployment/rollback.md`                  |
| Weekend release checklist | `docs/deployment/weekend-release-checklist.md` |
| Fresh reset               | `docs/deployment/fresh-reset.md`               |
| API conventions           | `docs/api-conventions.md`                      |
| Architecture              | `docs/architecture.md`                         |
| Branching strategy        | `docs/branching.md`                            |
