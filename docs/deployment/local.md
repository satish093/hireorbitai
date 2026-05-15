# Local development

Quickstart for running HireOrbit AI on your laptop. For production, see [cloudpanel.md](cloudpanel.md).

## Prerequisites

- **Node 22 LTS** — `.nvmrc` is committed, so `nvm use` picks it up.
- **PostgreSQL 14+** running locally (or reachable via `DATABASE_URL`).
- **Brevo account** with a verified sender domain (transactional email).
- **Anthropic API key** for AI features (optional — features that need it 5xx without it).

## 1. Clone + bootstrap

```bash
git clone https://github.com/<you>/hireorbitai.git
cd hireorbitai
nvm use
```

## 2. Database

```bash
createdb hireorbitai
export DATABASE_URL="postgres://localhost/hireorbitai"
psql "$DATABASE_URL" -f database/schema.sql
psql "$DATABASE_URL" -f database/auth-hardening.sql
psql "$DATABASE_URL" -f database/admin-user-management.sql
psql "$DATABASE_URL" -f database/feature-flags.sql
# …plus any feature modules you want: tasks.sql, training.sql, messages.sql, etc.
```

`schema.sql` is idempotent; feature migrations can be applied in any order.

## 3. Backend

```bash
cd backend
cp .env.example .env
# Fill in DATABASE_URL, JWT_SECRET, STORAGE_URL_SECRET, BREVO_API_KEY, …
# JWT_SECRET and STORAGE_URL_SECRET each need 32+ chars. Generate with:
#   node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
mkdir -p /tmp/hireorbitai-uploads     # or whatever UPLOADS_DIR you set

npm ci

# Before running bootstrap:admin, set DEFAULT_ADMIN_EMAIL + DEFAULT_ADMIN_PASSWORD
# (>= 12 chars) in .env — no fallback credentials exist in source.
npm run bootstrap:admin

npm run dev    # tsx watch + --env-file=.env
```

Backend listens on `http://localhost:4000`. Health: `GET /healthz`. Readiness: `GET /ready`.

## 4. Frontend

```bash
cd ../frontend
cp .env.example .env
# VITE_API_URL=http://localhost:4000
npm ci
npm run dev
```

Open `http://localhost:5173`.

## 5. First sign-in

Sign in with the `DEFAULT_ADMIN_EMAIL` / `DEFAULT_ADMIN_PASSWORD` you set. The app immediately routes you to `/change-password` and refuses to leave until you pick a new one. That's the forced-rotation policy — the seeded credentials become unusable as soon as you rotate.

## Useful scripts

| Command                                                      | What it does                                  |
| ------------------------------------------------------------ | --------------------------------------------- |
| `npm run dev` (backend)                                      | tsx watch loop with auto-restart              |
| `npm run dev` (frontend)                                     | Vite dev server with HMR                      |
| `npm run typecheck`                                          | `tsc --noEmit`, both halves                   |
| `npm run build`                                              | Production build, both halves                 |
| `npm run bootstrap:admin` (backend)                          | Create / rotate the SUPER_ADMIN               |
| `node --env-file=.env scripts/seed-users.mjs` (backend)      | Demo users (refuses in `NODE_ENV=production`) |
| `node --env-file=.env scripts/seed-leadership.mjs` (backend) | Demo org chart                                |

## Hot tips

- Vite **bakes `VITE_*` env vars into the bundle at build time**. Changing `.env` requires re-running `npm run build`.
- `--env-file=.env` is a Node 22 built-in — there is no `dotenv` dep.
- The backend's `requireFeature()` middleware reads from `public.feature_flags`. To toggle a module locally, `UPDATE public.feature_flags SET enabled = false WHERE key = 'training'`.
- Uploaded files live under `UPLOADS_DIR` on disk. Delete the directory to reset.
