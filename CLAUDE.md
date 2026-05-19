# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository

HireOrbit AI — npm-workspaces monorepo (`backend/`, `frontend/`, `shared/`) for a role-based consultant marketing + recruiting platform. **Self-hosted everything**: Node 22 + self-hosted PostgreSQL + filesystem storage on a single VPS. No managed Auth, no managed Postgres, no managed Storage.

Node 22 LTS is hard-required (`engines.node >= 22.0.0` in every package). The backend relies on Node 22 built-ins: `--env-file`, native `fetch`, `--import tsx`. Don't downgrade.

## Common commands

Run from the repo root unless noted. All scripts work on macOS / Linux / Windows PowerShell.

```bash
# Full verification (what CI runs)
npm run typecheck                       # builds @hireorbitai/shared then tsc --noEmit in backend + frontend
npm run lint                            # both workspaces, eslint --max-warnings 0
npm run format                          # prettier --write across the repo
npm run build                           # shared:build + backend tsc + frontend vite build

# Backend
npm --prefix backend run dev            # node --watch --import tsx --env-file=.env src/server.ts
npm --prefix backend run build          # tsc to dist/
npm --prefix backend run start          # node --env-file=.env dist/server.js (local-prod)
npm --prefix backend run start:prod     # PM2 uses this (env supplied by PM2/systemd)
npm --prefix backend test               # vitest run
npm --prefix backend run test:watch
npm --prefix backend test -- src/services/permission.service.test.ts   # single file
npm --prefix backend run bootstrap:admin                                 # seed first SUPER_ADMIN
npm --prefix backend run migrate:up                                      # node-pg-migrate forward
npm --prefix backend run migrate:create -- <name>                        # new migration file
npm --prefix backend run lint:fix

# Frontend
npm --prefix frontend run dev           # vite dev server on :5173
npm --prefix frontend run build         # tsc -b && vite build
npm --prefix frontend run typecheck     # tsc --noEmit (no emit, just check)

# Shared types package (rebuild after editing shared/src/**)
npm run shared:build
```

The pre-commit hook (lint-staged) runs prettier on every staged file. Husky lives under `.husky/`.

## Big-picture architecture

### Three-package workspace

- **`shared/`** — Pure TypeScript types + constants (roles, tier helpers, task enums). Dual-published as CJS + ESM via a `tsconfig.cjs.json` + a `scripts/fix-cjs.mjs` post-build patcher. Backend and frontend both `import { Role, MANAGER_TIER, … } from '@hireorbitai/shared'`. **You must `npm run shared:build` after editing `shared/src/**`** before typecheck/dev picks up the change — both halves consume the built `dist/`, not the source.
- **`backend/`** — Express + TypeScript (CommonJS output). Everything that touches data lives here.
- **`frontend/`** — Vite + React 18 + TypeScript (ESM).

### Backend request pipeline

```
HTTP request
  ↓
server.ts: helmet → CORS → compression → hpp → pino-http (requestId) → express-rate-limit
  ↓
routes/index.ts mounts public routes (auth handshake, /files, invitations preview),
                then requireAuth + blockIfMustChangePassword,
                then feature-flag-gated routers.
  ↓
controllers/*.controller.ts — Zod-validate body/query, call services/repositories/db
  ↓
middleware/errorHandler.ts — converts thrown httpError() to JSON envelope, logs to pino
```

Key choke points to know:

- **`middleware/auth.ts`** — `requireAuth`, `requireRole(...)`, `requireAdmin`, `blockIfMustChangePassword`. Roles are gated here; per-row ownership is gated in the controller.
- **`config/db.ts`** — custom **PostgREST-compat shim** over `pg.Pool`. Controllers use a Supabase-style chain: `db.from('users').select('…').eq('id', x).maybeSingle()`. The shim supports `.eq/.neq/.gt/.gte/.lt/.lte/.is/.in/.like/.ilike/.contains/.overlaps`, `.or()` with nested `and(...)/or(...)/not.` groups, `.order().range().limit()`, `count: 'exact' | 'head'`, and embedded joins like `'recruiter:recruiters!recruiter_id(...)'`. **Every value is parameterized; every column name goes through `qi()` which whitelists `[a-zA-Z_][a-zA-Z0-9_]*`** — never bypass these by inlining identifiers.
- **`config/env.ts`** — Zod-validated env, fail-fast at startup. Add new env vars here; importing `env` anywhere downstream is the only sanctioned way to read process.env.
- **`config/auth.local.ts`** — bcrypt + JWT auth (issued by us, not by a managed auth provider). Mounted under `db.auth.*` so controllers read like Supabase-style auth (`db.auth.signInWithPassword`, `db.auth.admin.createUser`, etc.).
- **`config/storage.local.ts`** — filesystem storage. Downloads come out of `GET /api/files/:bucket/*` behind HMAC-signed expiring URLs.
- **`services/permission.service.ts`** — centralized "can A interact with B" engine for messaging. 30s in-memory cache keyed by user+role. Reads `public.v_user_relationships` (a view union'ing reports_to / recruiter_managers / recruiters.manager_id / consultants.recruiter_id). When you wire new relationship mutations, call `invalidatePermissionCache(userId)`.
- **`services/realtime.service.ts`** — Postgres `LISTEN/NOTIFY` → Server-Sent Events for the browser. `publishToUser(userId, event, payload)` is the canonical push helper. The transport is SSE; the nginx vhost needs `proxy_buffering off` for `/api/realtime/stream`.
- **`services/auth.service.ts`** — login / changePassword / requestPasswordReset / completePasswordReset / adminCreateUser / setUserStatus. Always normalize email to lowercase before lookup; the DB stores lowercase + has a `users_lower_email_unique_idx` functional index.
- **`services/brevo.service.ts`** — single email transport. Every transactional email path (welcome+temp-password, invitation, password-reset, password-changed, account-locked, reminder dispatch, daily digest) goes through here. Do **not** add a second provider; the env schema only knows Brevo.

### Authorization model

Roles live in `shared/src/roles.ts`:

```
SUPER_ADMIN > CEO > CTO > DIRECTOR > MANAGER ≈ HR_MANAGER > DEVELOPER > RECRUITER > CONSULTANT

OWNER_TIER     = SUPER_ADMIN, CEO
ADMIN_TIER     = OWNER_TIER + CTO, DIRECTOR
MANAGER_TIER   = ADMIN_TIER + MANAGER, HR_MANAGER, DEVELOPER
OPERATOR_TIER  = MANAGER_TIER + RECRUITER
ALL_ROLES      = OPERATOR_TIER + CONSULTANT
```

Authorization is **two-layered**: `requireRole(...)` on the route gates by tier, but every handler that operates on a specific row must **load the row, verify ownership against `req.user`, and return 404 (not 403) if ownership fails** so endpoints don't double as existence oracles. There is no RLS — the DB runs as one privileged Postgres role, so app-level checks are the canonical boundary. When in doubt, mirror the patterns in `applications.controller.ts` (`loadAndAuthorize`) and `interviews.controller.ts`.

Mass-assignment guards: every controller that does `db.from('x').update(req.body)` or `db.insert(req.body)` MUST validate against a `.strict()` Zod schema that excludes server-controlled fields (`created_by`, `user_id`, `recruiter_id`, `consultant_id`, role-related columns). The existing IDOR review already swept this once — keep the bar.

### Migrations

Two coexisting systems for historical reasons:

- `database/*.sql` — flat files applied manually with `psql -f`. Order matters; start with `schema.sql` then layer feature migrations (`tasks.sql`, `training.sql`, etc.). README has the canonical order.
- `backend/migrations/*.sql` — `node-pg-migrate` style, tracked in `pgmigrations` table. Run with `npm --prefix backend run migrate:up`. Use this for any NEW migration going forward; the `database/*.sql` set is the historical baseline.

Every controller that touches a column added by a late-arrival migration has retry-and-strip logic for the schema-cache error path. Don't rip that out unless the feature is rolled out across all environments.

### Frontend

- **Routing** — `App.tsx` uses `React.lazy()` for every page except auth + dashboards (the immediate-paint surface stays in the main chunk). Wrap async pages in `<Suspense fallback={<RouteFallback />}>`.
- **`ProtectedRoute`** — fail-closed RBAC gate plus consultant/recruiter onboarding redirects. `<FeatureGuard feature="x">` wraps anything behind a feature flag.
- **`services/api.ts`** — axios with bearer interceptor + auto-refresh ~60s before access-token expiry. 401 / 423 responses boot the user to login or the lockout screen respectively.
- **`hooks/useInvalidate.ts`** — cross-page invalidation channel. After a mutation, call `invalidate('tasks')` (or `'messages'`, etc.); listening pages refetch. Use this instead of routing tricks for "this list should update when that page edits a row."
- **`hooks/useRealtime.ts`** — subscribes to the SSE stream with auto-reconnect + exponential backoff. Pass a handler map keyed by event name (e.g. `'message:new'`).
- **Design tokens** — `frontend/src/index.css` defines `.skeleton`, `.hover-lift`, `.press`, `.safe-pt`, etc.; `prefers-reduced-motion` neutralizes them globally. Use `min-h-dvh` not `min-h-screen` (iOS Safari URL bar). Don't add `viewport-fit=cover` without also adding safe-area padding.

### Job ingestion

`backend/src/services/jobIngestion.service.ts` runs pluggable drivers (Greenhouse / Lever / RemoteOK / Remotive / Arbeitnow / Adzuna / JSearch / Ashby / Jooble / USAJobs / SerpAPI / SearchApi / Monster / manual). The scheduler (`backend/src/jobs/scheduler.ts`) wires `jobs-sync.job`, `reminders.job`, `daily-digest.job`, and `sessions-purge.job` on intervals. Each job has `name`, `intervalMs`, `initialDelayMs`, and an idempotent `run()`. Reminders use exponential-backoff retry (1m → 16m, 5 attempts max) before being force-marked SENT.

## Conventions

- **All errors thrown via `httpError(status, message, details?)`** from `backend/src/types/index.ts`. Never `throw new Error()` from a request path.
- **Audit-log security events** via `audit({ action, user_id, email, req, metadata })` (`services/audit.service.ts`). The `AuditAction` union is closed — extend it before adding a new event verb.
- **Zod schemas live alongside controllers**, not in a separate validators folder. Use `.strict()` on every body schema that hits an `INSERT` / `UPDATE`.
- **Logger** — pino with redaction in `config/logger.ts`. Use `req.log` inside handlers; it inherits requestId.
- **Commit messages** — Conventional Commits (`feat`, `fix`, `chore`, `docs`, `refactor`, `perf`, `test`, `build`, `ci`, `revert`, `release`). The commit-msg hook warns but doesn't enforce (set `HIREORBITAI_STRICT_COMMITS=1` to enforce).

## Deploy story

- `chore/full-refactor` and other working branches: free for development.
- Push to **`main`** to trigger `.github/workflows/deploy-production.yml` — SSH-deploys to the VPS via `scripts/update.sh` (git pull + build + PM2 reload + smoke).
- After deploy, apply any pending SQL migrations:
  ```bash
  set -a; source ~/hireorbitai/backend/.env; set +a
  psql "$DATABASE_URL" -f ~/hireorbitai/database/<file>.sql
  ```
- PM2 ecosystem at `backend/ecosystem.config.cjs`; logs at `~/.pm2/logs/` on the VPS.

## Pitfalls

- **`shared` package not rebuilt** is the #1 cause of phantom type errors. Run `npm run shared:build` before debugging.
- **Bare `psql` from an SSH shell** won't have `$DATABASE_URL` — source `backend/.env` first.
- **`db.from(...).update(req.body)` without a Zod allowlist** is a mass-assignment bug. Don't.
- **Querying with `.ilike('email', x)` on user-supplied email** allows wildcard matching — always use `.eq()` after `email.toLowerCase()`.
- **`min-h-screen` / `h-screen`** break on iOS Safari due to the URL bar. Use `min-h-dvh` / `h-dvh`.
- **Frontend `VITE_*` vars are baked at build time** — changing them requires a fresh `npm --prefix frontend run build`.
- **Job ingestion runs on a ~$10/month Plan B budget.** Only the dedicated LinkedIn RapidAPI driver is paid (~$10 Basic tier, ~1000 req/mo). Dice / Monster / CareerBuilder coverage comes from **JSearch's free 150/mo tier** using `site:` query operators that surface them via the `publisher` field — **not** from the dedicated `monster` source (intentionally disabled). `JOB_SYNC_INTERVAL_MS` is intentionally 24h, not the default 6h, to fit the JSearch free quota. If you re-enable the `monster` source row or shorten the sync interval, the JSearch free tier breaks within a week. Canonical migration: `database/enable-jobs-plan-b.sql`.
