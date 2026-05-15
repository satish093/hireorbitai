# HireOrbit AI

Role-based consultant marketing & recruiting portal. AI-assisted resume scoring, job matching, vendor pitch generation, plus a full task / messaging / reporting / training workspace for recruiting teams.

Self-hosted from the ground up — Node + Postgres + filesystem storage on a single VPS. No managed Auth, no managed Storage, no managed Postgres.

---

## Features

- **Authentication & RBAC** — backend-issued JWT access tokens (bcrypt password hashes, refresh-token rotation in `public.auth_sessions`); 9 roles with explicit tier helpers (`OWNER_TIER`, `ADMIN_TIER`, `MANAGER_TIER`, `OPERATOR_TIER`).
- **Forced password rotation** on first sign-in for admin-created users; account lockout after N failed attempts.
- **Custom forgot-password / reset-password flow** — branded Brevo emails with hashed reset tokens (15-min TTL).
- **Admin user management** — All Users list, per-user detail page with audit log, deactivated-accounts view, inline lifecycle actions (deactivate, suspend, ban, reactivate, send-reset, delete) with cross-page invalidation.
- **Consultant onboarding** + recruiter onboarding gates.
- **Resume management** — versioned, with current-resume markers, AI scoring against job descriptions.
- **AI features (Anthropic Claude)** — resume score, ATS match, vendor email draft, structured JD requirement extraction, per-skill scoring, "Fix My Resume" tailoring loop.
- **Job ingestion** — pluggable drivers for Greenhouse, Lever, RemoteOK, Remotive, Arbeitnow, Adzuna, JSearch (LinkedIn / Indeed via RapidAPI), Ashby, Jooble, USAJobs, SerpAPI, SearchApi.io, Monster, plus manual import. Auto-match-and-notify.
- **Application pipeline** — submission tracking, duplicate-submission guard, ATS scoring, status transitions, funnel events.
- **Interviews & calendar** — schedule real + mock interviews, capture feedback, click-to-filter day view.
- **Tasks** — Kanban board + list view, drag-drop status changes, comments, attachments, assigned-to-me view, dashboard metrics.
- **Messages** — internal DM with conversation list, presence dots, unread counts.
- **Training / LMS** — courses, lessons, quizzes, assignments, AI-generated study plans, completion reports.
- **Reports** — recruiter performance, consultant pipeline, placement analytics, daily activity log, time-in-app tracking.
- **Vendors / Clients** — partner directories.
- **User groups** — multi-tenancy primitive ("Cloudfen", "Zangle IT", etc.).
- **Feature flags** — global + per-group overrides (SUPER_ADMIN / CEO).

---

## Tech Stack

**Frontend**

- React 18 + TypeScript + Vite
- React Router v6, React Hook Form, Axios
- Tailwind CSS with custom design tokens (motion keyframes, hover-lift, skeleton shimmer)
- react-hot-toast

**Backend**

- Node.js **22 LTS** (uses native `--env-file` and `fetch`)
- Express 4 + TypeScript (CommonJS)
- Zod for env validation + every controller's request body
- Pino + pino-http for structured request logging with `requestId`
- Helmet, hpp, compression, express-rate-limit
- Multer for uploads

**Database**

- PostgreSQL (self-hosted on the VPS) via `pg`
- Custom PostgREST-style query builder (`backend/src/config/db.ts`) — gives controllers the familiar `db.from('users').select('…').eq().single()` shape without an ORM dependency.

**Auth**

- bcryptjs password hashes in `public.users.password_hash`
- HS256 JWT access tokens signed with `JWT_SECRET`
- Bcrypt-hashed refresh tokens in `public.auth_sessions`; rotated on every refresh; revoked by deleting the row + bumping `users.session_version`.

**File storage**

- Local filesystem under `UPLOADS_DIR`. Downloads served at `GET /api/files/:bucket/*` behind HMAC-signed expiring URLs (`STORAGE_URL_SECRET`).

**AI**

- Anthropic Claude (default `claude-haiku-4-5-20251001`) via `@anthropic-ai/sdk` with zod-validated structured outputs.

**Email**

- Brevo (transactional REST v3) — every email path (welcome+temp password, invitation, password reset, password changed, account locked) goes through the Brevo client.

**Hosting**

- Hostinger VPS + CloudPanel + Nginx (reverse proxy)
- PM2 (process manager, ecosystem config in repo)
- Let's Encrypt via CloudPanel

---

## Repo layout

```
hireorbitai/
├── backend/                          Node 22 + Express + TypeScript API
│   ├── src/
│   │   ├── server.ts                 helmet/CORS/hpp/compression/rate-limit + graceful shutdown
│   │   ├── config/
│   │   │   ├── env.ts                Zod-validated env (fail-fast at startup)
│   │   │   ├── logger.ts             Pino with redaction
│   │   │   ├── db.ts                 pg Pool + PostgREST-style query builder
│   │   │   ├── auth.local.ts         bcrypt + JWT auth (signIn / refresh / admin.*)
│   │   │   ├── storage.local.ts      filesystem storage + HMAC-signed URLs
│   │   │   ├── anthropic.ts
│   │   │   └── bootstrap.ts          opt-in default-admin provisioning
│   │   ├── middleware/
│   │   │   ├── auth.ts               requireAuth + requireRole + requireAdmin + blockIfMustChangePassword
│   │   │   ├── featureFlag.ts
│   │   │   └── errorHandler.ts
│   │   ├── routes/                   one router per resource, plus files.routes.ts for downloads
│   │   ├── controllers/              one per resource
│   │   ├── services/
│   │   │   ├── auth.service.ts       login / changePassword / forgotPassword / resetPassword / setUserStatus
│   │   │   ├── audit.service.ts      append-only auth_audit_logs
│   │   │   ├── brevo.service.ts      Brevo v3 REST + 5 templates
│   │   │   ├── invitation.service.ts
│   │   │   ├── storage.service.ts    thin wrapper around storage.local
│   │   │   ├── ai.service.ts
│   │   │   ├── training*.service.ts
│   │   │   └── jobIngestion.service.ts
│   │   ├── utils/password.ts         crypto-secure temp passwords + strength validator + token hash
│   │   └── types/index.ts
│   ├── scripts/
│   │   ├── bootstrap-admin.mjs       node --env-file=.env scripts/bootstrap-admin.mjs
│   │   └── seed-{users,leadership}.mjs
│   ├── ecosystem.config.cjs          PM2 process definition (uses --env-file)
│   ├── package.json                  engines.node >= 22.0.0
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── App.tsx                   routes + role gates
│   │   ├── main.tsx                  ErrorBoundary + Toaster
│   │   ├── config/env.ts             validated VITE_ vars
│   │   ├── context/AuthContext.tsx
│   │   ├── components/
│   │   │   ├── Button.tsx, Modal.tsx, DataTable.tsx, FormInput.tsx, …
│   │   │   ├── ProtectedRoute.tsx    fail-closed RBAC gate
│   │   │   ├── ErrorBoundary.tsx
│   │   │   └── PasswordField.tsx     show/hide + live strength hints
│   │   ├── hooks/
│   │   │   ├── useFeatureFlags.tsx
│   │   │   └── useInvalidate.ts      cross-page invalidation channel
│   │   ├── pages/                    33 pages incl. Training module
│   │   ├── services/
│   │   │   ├── api.ts                axios + bearer interceptor + auto-refresh + 401/423 boot
│   │   │   └── session.ts            backend-issued token store (localStorage)
│   │   └── utils/fileUrl.ts          centralized URL resolver
│   ├── tailwind.config.js
│   └── .env.example
├── database/                         PostgreSQL migrations (apply in order)
├── scripts/deploy.sh                 VPS-side: git pull + build + pm2 restart
├── DEPLOY.md                         end-to-end VPS guide
└── .gitignore                        excludes .env, node_modules, dist, build artifacts
```

---

## Local development

### Prerequisites

- **Node.js 22 LTS** — both packages pin `engines.node >= 22.0.0`. The repo includes `.nvmrc` so `nvm use` selects it.
- **PostgreSQL 14+** running locally (or reachable via `DATABASE_URL`).
- An Anthropic API key (for AI features).
- A Brevo account with your domain verified (for transactional email).

### 1. Clone

```bash
git clone https://github.com/<your-account>/hireorbitai.git
cd hireorbitai
nvm use   # picks Node 22 from .nvmrc
```

### 2. Database

```bash
createdb hireorbitai
export DATABASE_URL="postgres://localhost/hireorbitai"
psql "$DATABASE_URL" -f database/schema.sql
psql "$DATABASE_URL" -f database/auth-hardening.sql
psql "$DATABASE_URL" -f database/admin-user-management.sql
psql "$DATABASE_URL" -f database/feature-flags.sql
# …plus whichever feature modules you want (tasks.sql, training.sql, messages.sql, …)
```

### 3. Backend

```bash
cd backend
cp .env.example .env
nano .env     # fill in DATABASE_URL, JWT_SECRET, STORAGE_URL_SECRET, BREVO_*, etc.
mkdir -p /tmp/hireorbitai-uploads     # or whatever UPLOADS_DIR points at
npm ci
npm run build
# Before running bootstrap:admin, set DEFAULT_ADMIN_EMAIL and
# DEFAULT_ADMIN_PASSWORD (>= 12 chars) in backend/.env — there are no
# fallback credentials baked into the code.
npm run bootstrap:admin    # creates the first SUPER_ADMIN with must_change_password=true
npm run dev                # tsx watch + --env-file=.env
```

Backend listens on `http://localhost:4000`. Health: `GET /healthz`. Readiness: `GET /ready`.

### 4. Frontend

```bash
cd ../frontend
cp .env.example .env
nano .env     # VITE_API_URL=http://localhost:4000
npm ci
npm run dev
```

Open `http://localhost:5173`.

### 5. First sign-in

Use whatever `DEFAULT_ADMIN_EMAIL` and `DEFAULT_ADMIN_PASSWORD` you set in `backend/.env` before running `npm run bootstrap:admin`. The script refuses to provision an admin without both vars set (no fallback credentials are baked into the source).

The app immediately routes you to `/change-password` on first sign-in and refuses to leave until you pick a new password. That's the forced-rotation policy in action — the seeded password becomes unusable as soon as you rotate.

---

## Environment variables

### Backend (`backend/.env`)

| Var                          | Required                | Notes                                                                                                   |
| ---------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------- |
| `PORT`                       | no                      | default `4000`                                                                                          |
| `NODE_ENV`                   | no                      | `development` (default) / `production` / `test`                                                         |
| `APP_URL`                    | yes                     | full URL — e.g. `https://hireorbitai.com`                                                               |
| `FRONTEND_URL`               | yes                     | used in email links (reset / welcome / invitation)                                                      |
| `CORS_ORIGIN`                | yes                     | comma-separated allowlist of frontend origins                                                           |
| `TRUST_PROXY`                | no                      | `1` behind Nginx (default), `0` if Node listens on `:443` directly                                      |
| `DATABASE_URL`               | yes                     | `postgres://user:pass@host:5432/dbname`                                                                 |
| `DATABASE_SSL`               | no                      | `disable` (default), `require`, or `no-verify`                                                          |
| `UPLOADS_DIR`                | no                      | absolute path; default `/var/lib/hireorbitai/uploads`                                                   |
| `STORAGE_URL_SECRET`         | yes                     | min 32 chars — HMAC key for signed download URLs                                                        |
| `JWT_SECRET`                 | yes                     | min 32 chars — signs access tokens                                                                      |
| `JWT_ACCESS_TTL_SECONDS`     | no                      | default `3600`                                                                                          |
| `JWT_REFRESH_TTL_SECONDS`    | no                      | default `2592000` (30 days)                                                                             |
| `ANTHROPIC_API_KEY`          | yes if AI features used |                                                                                                         |
| `ANTHROPIC_MODEL`            | no                      | default `claude-haiku-4-5-20251001`                                                                     |
| `BREVO_API_KEY`              | yes                     | `xkeysib-…`; the only email provider we ship                                                            |
| `BREVO_SENDER_EMAIL`         | no                      | default `noreply@hireorbitai.com`                                                                       |
| `BREVO_SENDER_NAME`          | no                      | default `HireOrbit AI`                                                                                  |
| `COOKIE_SECRET`              | yes                     | min 32 chars (`node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"`)            |
| `INVITATION_EXPIRY_HOURS`    | no                      | default `72`                                                                                            |
| `TEMP_PASSWORD_EXPIRY_HOURS` | no                      | default `24`                                                                                            |
| `RESET_TOKEN_EXPIRY_MINUTES` | no                      | default `15`                                                                                            |
| `MAX_FAILED_LOGINS`          | no                      | default `5`                                                                                             |
| `LOCKOUT_MINUTES`            | no                      | default `30`                                                                                            |
| `RATE_LIMIT_WINDOW_MS`       | no                      | default `900000` (15 min)                                                                               |
| `RATE_LIMIT_MAX`             | no                      | default `3000` per window per authenticated user                                                        |
| `ENABLE_DEFAULT_ADMIN`       | no                      | `true` to runtime-bootstrap the default SUPER_ADMIN. Off by default — prefer `npm run bootstrap:admin`. |
| Job-source keys              | no                      | see `.env.example` for `JSEARCH_API_KEY`, `JOOBLE_API_KEY`, `RAPIDAPI_KEY`, etc.                        |

### Frontend (`frontend/.env`)

| Var            | Required | Notes                                                                                       |
| -------------- | -------- | ------------------------------------------------------------------------------------------- |
| `VITE_API_URL` | yes      | full URL incl. scheme — e.g. `https://api.hireorbitai.com` or `https://hireorbitai.com/api` |

> Vite **bakes these into the bundle at build time**. Changing them requires a fresh `npm run build`.

---

## Deployment

End-to-end CloudPanel guide lives in [docs/deployment/cloudpanel.md](./docs/deployment/cloudpanel.md); the operational runbook (backup / restore / incidents / rollback) is in [docs/deployment/production.md](./docs/deployment/production.md). Quick reference:

```bash
# On the VPS, in the cloned repo:
bash scripts/update.sh             # git pull + build + pm2 restart + smoke
bash scripts/update.sh backend     # backend only
bash scripts/update.sh frontend    # frontend only

bash scripts/backup.sh             # pg_dump + uploads tarball under ~/backups
bash scripts/restore.sh <stamp>    # restore from a backup stamp (requires --force)
bash scripts/healthcheck.sh        # full curl matrix against the public surface
```

`scripts/deploy.sh` (first-time deploy helper) is retained for backwards-compat; new ops should use `update.sh`.

---

## Auth flow at a glance

```
        sign in              ┌──────────────────────────────────┐
   POST /auth/login   ─────→ │ services/auth.service.login      │
                             │   • bcrypt compare password_hash │
                             │   • lockout / temp-pw / status   │
                             │   • issue JWT + refresh row      │
                             └─────────────┬────────────────────┘
                                           │
                              success      │      failure
                                           │
                ┌──────────────────────────┴────────┐
                ▼                                   ▼
   ┌────────────────────────┐             ┌────────────────────┐
   │ return { access_token, │             │ bump fail count    │
   │ refresh_token, user,   │             │ N? → lock + email  │
   │ must_change_password}  │             └────────────────────┘
   └─────────┬──────────────┘
             ▼
   frontend stores tokens in localStorage (services/session.ts).
   axios interceptor refreshes via /auth/refresh ~60s before exp.

   If must_change_password → frontend routes to /change-password
   (the only allowed protected route until rotation).
```

Other paths (forgot-password, reset-password, invitation handshake, admin lifecycle) are summarised in [DEPLOY.md](./DEPLOY.md).

---

## Scripts

**Backend** (`backend/package.json`)

- `npm run dev` — `node --watch --import tsx --env-file=.env src/server.ts`
- `npm run build` — `tsc -p tsconfig.json`
- `npm start` — `node --env-file=.env dist/server.js`
- `npm run typecheck` — `tsc --noEmit`
- `npm run bootstrap:admin` — `node --env-file=.env scripts/bootstrap-admin.mjs`

**Frontend** (`frontend/package.json`)

- `npm run dev` — Vite dev server
- `npm run build` — `tsc -b && vite build`
- `npm run preview` — preview the built bundle
- `npm run typecheck` — `tsc --noEmit`

**Repo root**

- `bash scripts/deploy.sh` — VPS-side: pulls, builds both halves, restarts PM2, smoke-curls

---

## Architecture notes

- **Drop-in query builder**: `config/db.ts` exposes `db.from(table)` with the chained-method shape the codebase was built around. Backed by `pg.Pool` + parameterised SQL. Reserve `db.query(sql, values)` for anything the builder can't express (foreign-key joins beyond simple to-one embeds, CTEs, etc.).
- **One source of truth for account lifecycle**: `setUserStatus()` in `auth.service.ts`. Both legacy (`/users/:id/deactivate`) and admin (`/admin/users/:id/status`) routes funnel through it. Keeps `status`, `is_active`, `status_reason`, `status_changed_at`, and `status_changed_by` always in sync; revokes refresh tokens on every non-active transition; audit-logged.
- **Cross-page state invalidation**: `frontend/src/hooks/useInvalidate.ts` is a tiny pub/sub keyed by domain (`'users' | 'tasks' | 'jobs' | 'applications' | 'invitations'`). Pages that mutate fire `invalidate(channel)`; pages that read use `useInvalidationListener(channel, refetch)`.
- **Fail-closed RBAC**: `ProtectedRoute` redirects to `/unauthorized` when a session exists but the profile didn't load — prevents privilege escalation when `/auth/me` 403s.
- **Brevo-only email**: every transactional email path goes through `services/brevo.service.ts`.
- **Rate limiting per authenticated user**: not per IP. So users on the same NAT (office network) don't compete for the bucket.
- **Centralised file URLs**: `frontend/src/utils/fileUrl.ts` resolves any path/URL safely, applies `noopener,noreferrer` on opens.

---

## Known follow-ups

Tracked in code comments and `DEPLOY.md` notes; not blockers for production:

- Reminders have no scheduler; rows are stored but no cron sends `due_at` notifications. Wire to a host cron when needed.
- Messages page polls every 8s active / 60s sidebar — works for the current load; switch to SSE or websockets when concurrency exceeds ~100 users.
- Job-search `/applications/none/events` is intentional (orphan funnel events with `application_id: null`); the backend special-cases the literal `'none'` segment.
- The `/jobs` dropdown in `Applications.tsx` loads all jobs unbounded; replace with a typeahead endpoint at scale.

---

## License

Private — all rights reserved.
