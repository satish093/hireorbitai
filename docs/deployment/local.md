# Local development

Run HireOrbit AI on your laptop in under 10 minutes. This guide covers Windows, macOS, and Linux. For VPS deployment see [cloudpanel.md](cloudpanel.md); for ops procedures see [production.md](production.md).

---

## Prerequisites

| Tool           | Version     | Install                                                    |
| -------------- | ----------- | ---------------------------------------------------------- |
| **Node.js**    | 22 LTS      | https://nodejs.org/ — or `nvm use` (`.nvmrc` is committed) |
| **PostgreSQL** | 14 or newer | https://www.postgresql.org/download/                       |
| **Git**        | any recent  | https://git-scm.com/                                       |

Optional, only if you want to exercise features that need them:

| Tool                  | Purpose                                           | Where to get a key             |
| --------------------- | ------------------------------------------------- | ------------------------------ |
| **Brevo** account     | Transactional email (invitations, password reset) | https://www.brevo.com/         |
| **Anthropic** API key | AI features (resume scoring, JD extraction)       | https://console.anthropic.com/ |

Both are optional in dev — the script writes a stub `BREVO_API_KEY` so the app starts even without real email, and AI endpoints return 5xx with a clear message until `ANTHROPIC_API_KEY` is set.

---

## Windows — one-command setup

From the repo root in **Command Prompt** or **PowerShell**:

```cmd
scripts\dev-windows.cmd
```

The script is idempotent and re-runnable. It performs:

1. **Prerequisite check** — verifies Node 22+ and `psql` are on PATH.
2. **Environment** — writes `backend/.env` and `frontend/.env` with auto-generated 48-byte secrets (`JWT_SECRET`, `STORAGE_URL_SECRET`, `COOKIE_SECRET`).
3. **Workspace install** — `npm install` at the root populates `shared/`, `backend/`, `frontend/`.
4. **Shared build** — compiles `@hireorbitai/shared` to dual ESM + CJS.
5. **Database** — creates the `hireorbitai` database, installs `pgcrypto`, applies every file under `database/` in the right order.
6. **Admin bootstrap** — creates the initial `SUPER_ADMIN` user and prints the credentials.
7. **Dev servers** — opens two new terminal windows running the backend (`:4000`) and the frontend (`:5173`).

### Flags

| Flag                                     | Purpose                                                        |
| ---------------------------------------- | -------------------------------------------------------------- |
| `-Force`                                 | Regenerate `.env` files (rotates the auto-generated secrets).  |
| `-SkipStart`                             | Bootstrap only; don't launch dev servers. Useful for CI.       |
| `-SkipDatabase`                          | Don't touch Postgres (use if you applied the schema manually). |
| `-DatabasePassword <pw>`                 | Pass the Postgres password without setting `PGPASSWORD`.       |
| `-DatabaseUser <user>`                   | Postgres role to connect as. Default: `postgres`.              |
| `-AdminEmail <e>` / `-AdminPassword <p>` | Override the generated admin credentials.                      |

### Stopping the servers

```cmd
scripts\stop-dev-windows.cmd
```

Kills the Node processes listening on `4000` and `5173`. Other Node processes you have running are untouched.

### Troubleshooting (Windows)

| Symptom                                           | Fix                                                                                                                                                                              |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `psql is not recognized`                          | Add `C:\Program Files\PostgreSQL\<ver>\bin` to your `PATH` (Settings → Environment Variables → Path → Edit → New). Reopen your terminal.                                         |
| `Could not connect to Postgres on 127.0.0.1:5432` | Open `services.msc`, find `postgresql-x64-<ver>`, click Start. Or pass `-DatabasePassword` if you set a password during install.                                                 |
| PowerShell "running scripts is disabled"          | The `.cmd` wrapper bypasses the policy automatically. If you're invoking `dev-windows.ps1` directly, run via `powershell -ExecutionPolicy Bypass -File scripts\dev-windows.ps1`. |
| `EADDRINUSE :4000` or `:5173`                     | Run `scripts\stop-dev-windows.cmd` first.                                                                                                                                        |

---

## macOS / Linux — manual setup

The Windows script does all of this for you; on Unix the steps are short enough to run by hand.

### 1. Clone and select Node 22

```bash
git clone git@github.com:satish093/hireorbitai.git
cd hireorbitai
nvm use     # picks Node 22 from .nvmrc
```

### 2. Create the database

```bash
createdb hireorbitai
psql -d hireorbitai -c 'CREATE EXTENSION IF NOT EXISTS pgcrypto'
export DATABASE_URL='postgres://localhost/hireorbitai'

# One file does the whole schema (recommended):
psql "$DATABASE_URL" -f database/init.sql
```

`database/init.sql` is the consolidated baseline — every per-feature SQL file concatenated in dependency order. Idempotent; safe to re-run. Regenerate after editing any individual source file with `npm run db:build-init`.

<details>
<summary>Or apply individual files (advanced)</summary>

```bash
# Baseline (order matters):
psql "$DATABASE_URL" -f database/schema.sql
psql "$DATABASE_URL" -f database/auth-hardening.sql
psql "$DATABASE_URL" -f database/admin-user-management.sql
psql "$DATABASE_URL" -f database/feature-flags.sql

# Feature modules (any order, all idempotent):
for f in database/{tasks,messages,training,user-groups-and-presence,user-activity-tracking}.sql; do
  [ -f "$f" ] && psql "$DATABASE_URL" -f "$f"
done
```

</details>

### 3. Install + build the workspace

```bash
npm install          # populates shared/ + backend/ + frontend/ via workspaces
npm run shared:build # emits shared/dist (ESM + CJS)
```

### 4. Configure the backend

```bash
cd backend
cp .env.example .env
```

Edit `.env` and set at minimum:

```env
DATABASE_URL=postgres://localhost/hireorbitai
JWT_SECRET=<generate with the command below>
STORAGE_URL_SECRET=<generate with the command below>
COOKIE_SECRET=<generate with the command below>
UPLOADS_DIR=/tmp/hireorbitai-uploads
DEFAULT_ADMIN_EMAIL=admin@hireorbitai.local
DEFAULT_ADMIN_PASSWORD=Local-Dev-Pass-12345
DISABLE_JOBS=true          # quiet background workers in local dev
```

Generate any secret with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
```

### 5. Bootstrap the admin user

```bash
mkdir -p /tmp/hireorbitai-uploads
npm run bootstrap:admin
```

The script refuses to run without both `DEFAULT_ADMIN_EMAIL` and `DEFAULT_ADMIN_PASSWORD` (≥ 12 chars) — no fallback credentials exist in source.

### 6. Configure the frontend

```bash
cd ../frontend
cp .env.example .env
# Set VITE_API_URL=http://localhost:4000
```

### 7. Start the dev servers

Two terminals:

```bash
# Terminal 1
cd backend && npm run dev

# Terminal 2
cd frontend && npm run dev
```

The backend listens on `http://localhost:4000` (health: `GET /healthz`, readiness: `GET /ready`). The frontend is at `http://localhost:5173`.

---

## First sign-in

Open `http://localhost:5173`, sign in with the admin credentials the bootstrap script printed (or that you set via env). The app immediately routes you to `/change-password` and refuses to leave until you pick a new password. That's the forced-rotation policy — the seeded password becomes unusable as soon as you rotate.

---

## Daily workflow

| Action                         | Command                                                                                                         |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Start dev servers (Windows)    | `scripts\dev-windows.cmd`                                                                                       |
| Start dev servers (Unix)       | `cd backend && npm run dev` + `cd frontend && npm run dev`                                                      |
| Stop dev servers (Windows)     | `scripts\stop-dev-windows.cmd`                                                                                  |
| Type-check the whole monorepo  | `npm run typecheck`                                                                                             |
| Production build (both halves) | `npm run build`                                                                                                 |
| Lint                           | `npm run lint` / `npm run lint:fix`                                                                             |
| Format                         | `npm run format` / `npm run format:check`                                                                       |
| Create a SUPER_ADMIN           | `cd backend && npm run bootstrap:admin`                                                                         |
| Seed demo users + org chart    | `cd backend && node --env-file=.env scripts/seed-users.mjs && node --env-file=.env scripts/seed-leadership.mjs` |
| Apply a new SQL migration      | `cd backend && npm run migrate:up`                                                                              |
| Create a new SQL migration     | `cd backend && npm run migrate:create <slug>`                                                                   |

---

## Hot tips

- **Vite bakes `VITE_*` env vars into the bundle at build time.** Changing `frontend/.env` requires re-running `npm run build`. The dev server picks them up automatically.
- **`--env-file=.env`** is a Node 22 built-in — no `dotenv` package is involved.
- **Feature flags** are read from `public.feature_flags`. To turn a module off locally:
  ```sql
  UPDATE public.feature_flags SET enabled = false WHERE key = 'training';
  ```
- **Uploads** live under `UPLOADS_DIR` on disk. `rm -rf` the directory to reset.
- **The job scheduler is off in dev** when you used the Windows script (it sets `DISABLE_JOBS=true`). Set `DISABLE_JOBS=false` if you're testing reminders or session-purge jobs.
- **Logs** are JSON via Pino. Pipe through `pino-pretty` for readable output:
  ```bash
  cd backend && npm run dev 2>&1 | npx pino-pretty
  ```

---

## What's next

- Production deployment to a Hostinger VPS with CloudPanel → [cloudpanel.md](cloudpanel.md)
- Day-2 operations (deploys, backups, incidents) → [production.md](production.md)
- The system design overview → [../architecture.md](../architecture.md)
