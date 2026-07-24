# Architecture

High-level mental model for anyone touching the HireOrbit AI codebase.

```
                      ┌─────────────────────────────────────────────┐
                      │                 Browser                     │
                      │  ┌──────────────────────────────────────┐   │
                      │  │ React 18 + Vite + React-Router       │   │
                      │  │  AuthContext (JWT in localStorage)   │   │
                      │  │  FeatureFlagsProvider                │   │
                      │  │  axios `api` (dedup + 429 cooldown)  │   │
                      │  │  Sidebar / Messages pollers          │   │
                      │  └──────────────────────────────────────┘   │
                      └─────────────────────┬───────────────────────┘
                                            │  HTTPS  (Bearer JWT)
                                            ▼
                      ┌─────────────────────────────────────────────┐
                      │              Nginx (CloudPanel)             │
                      │  /            → static dist/                 │
                      │  /api/        → 127.0.0.1:4000 (Node/PM2)   │
                      └─────────────────────┬───────────────────────┘
                                            │
                                            ▼
                      ┌─────────────────────────────────────────────┐
                      │       Express 4 + TypeScript + pg           │
                      │  ┌────────────────┐  ┌──────────────────┐  │
                      │  │ middleware     │  │ controllers      │  │
                      │  │ requireAuth    │  │ auth, jobs, ...  │  │
                      │  │ requireFeature │  │                  │  │
                      │  │ requireRole    │  └──────────────────┘  │
                      │  └────────────────┘  ┌──────────────────┐  │
                      │  ┌────────────────┐  │ services         │  │
                      │  │ config         │  │ auth, ai, brevo, │  │
                      │  │ db.ts          │  │ storage, training│  │
                      │  │ auth.local.ts  │  │ jobIngestion     │  │
                      │  │ storage.local  │  └──────────────────┘  │
                      │  │ env.ts         │                          │
                      │  └────────────────┘                          │
                      └─────────────────────┬───────────────────────┘
                                            │
                ┌───────────────────────────┼──────────────────────────┐
                ▼                           ▼                          ▼
        ┌─────────────────┐     ┌──────────────────────┐    ┌────────────────────┐
        │ PostgreSQL      │     │ /var/lib/.../uploads │    │ External APIs      │
        │ public.users    │     │  resumes/, tasks/    │    │  Brevo (email)     │
        │ public.jobs     │     │  HMAC-signed URLs    │    │  Anthropic (LLM)   │
        │ auth_sessions   │     │                      │    │  Greenhouse/Lever/ │
        │ ...             │     │                      │    │  RemoteOK/...      │
        └─────────────────┘     └──────────────────────┘    └────────────────────┘
```

## Layers

### Frontend (`frontend/`)

- **Routing**: React Router v6. `App.tsx` declares every route; `ProtectedRoute` is the fail-closed gate.
- **State**: lightweight — no Redux / Zustand / react-query. Domain state lives in pages; shared state in `AuthContext` + `FeatureFlagsContext`. Cross-page invalidation rides the tiny pub-sub in [`hooks/useInvalidate.ts`](../frontend/src/hooks/useInvalidate.ts).
- **API client**: axios singleton in [`services/api.ts`](../frontend/src/services/api.ts). It owns: bearer-token injection, silent refresh, in-flight GET dedup, client-side 429 cooldown, debounced 401-redirect.
- **Session store**: [`services/session.ts`](../frontend/src/services/session.ts) — localStorage-backed, pure functions, emits a `hireorbitai:session-changed` CustomEvent on writes for cross-tab sync.
- **Polling**: each component owns its own `setTimeout` self-rescheduling loop with `document.hidden` guard, inflight skip, 10% jitter. No centralised poller — keeps the dep graph simple at the cost of a few duplicated patterns.

### Backend (`backend/`)

Layers in execution order on each request:

1. **`server.ts`** — Express setup, helmet/CORS/hpp/compression, global JWT-keyed rate limiter, per-IP auth limiter on brute-forceable routes.
2. **`routes/`** — thin: one file per resource, mounts middleware, calls controller methods.
3. **`middleware/`** — `auth.ts` (requireAuth + RBAC), `featureFlag.ts` (per-flag gate), `errorHandler.ts` (centralised 4xx/5xx JSON shape), `upload.ts` (multer presets).
4. **`controllers/`** — request shape validation (zod), permission checks, delegation to services. No raw SQL.
5. **`services/`** — business logic. `auth.service.ts`, `ai.service.ts`, `brevo.service.ts`, `storage.service.ts`, `invitation.service.ts`, `jobIngestion.service.ts`, `training.service.ts`, `audit.service.ts`.
6. **`repositories/`** — only `training.repository.ts` today; everything else still talks to `db` directly via the query builder. See "Technical debt" below.
7. **`config/`** — singletons: `env.ts` (zod-validated env), `db.ts` (pg pool + PostgREST-style builder), `auth.local.ts` (bcrypt + JWT), `storage.local.ts` (filesystem + HMAC), `logger.ts` (pino), `anthropic.ts`, `bootstrap.ts`.

### Database (`database/`)

PostgreSQL, applied via plain `psql` against `DATABASE_URL`. `schema.sql` is the canonical baseline; each feature ships a separate idempotent `*.sql` migration. No migration tool (Prisma, knex, …) — runs against a single VPS where ad-hoc `psql` is fine.

### Deployment (`scripts/`, `nginx/`)

- [`scripts/deploy.sh`](../scripts/deploy.sh) — first-time deploy helper.
- [`scripts/update.sh`](../scripts/update.sh) — routine `git pull` + build + restart + smoke.
- [`scripts/backup.sh`](../scripts/backup.sh) — daily `pg_dump` + uploads tarball.
- [`scripts/restore.sh`](../scripts/restore.sh) — restore from a backup stamp.
- [`scripts/healthcheck.sh`](../scripts/healthcheck.sh) — curl matrix.
- [`nginx/hireorbitai.conf.example`](../nginx/hireorbitai.conf.example) — snippet to drop inside the CloudPanel-generated vhost.
- [`backend/ecosystem.config.cjs`](../backend/ecosystem.config.cjs) — PM2 process definition.

## Key contracts

### Auth response shape (`POST /api/auth/login`)

```json
{
  "access_token": "ey...",
  "refresh_token": "<48-byte base64url>",
  "expires_at": 1700000000,
  "user": { "id": "uuid", "email": "...", "role": "SUPER_ADMIN", "full_name": "..." },
  "must_change_password": false
}
```

### Refresh shape (`POST /api/auth/refresh`)

```json
{ "access_token": "ey...", "refresh_token": "<rotated>", "expires_at": 1700000000 }
```

### Error envelope (every controller)

```json
{ "error": "<message>", "details": <optional structured payload> }
```

Plus `retry_after_seconds` on 429.

### File download URL

`/api/files/<bucket>/<path>?exp=<unix-seconds>&sig=<hex sha256 HMAC>`

The path is HMAC'd with `env.storage.urlSecret`; the route does a constant-time compare. Downloads are public-by-URL — security is the unforgeability of the signature, not session auth.

## Performance guardrails (already in place)

- **API**: GET dedup, 429 cooldown map, silent refresh debouncing, never-clear-session-on-transient-error.
- **Pollers**: self-rescheduling timeouts, jitter, inflight skip, visibility pause.
- **Rate limit**: JWT-keyed (per-user) before `requireAuth` runs. `/auth/refresh` is exempt so a transient burst doesn't cascade users into a logout.
- **Effects**: dashboards and feature-flags depend on `user.id`, not the full `profile` / `session` object reference.

## Technical debt — explicitly deferred

Documented here so the next contributor doesn't have to discover it:

- **No repository layer for most resources** — controllers call `db.from(...)` directly. Fine at current scale. Worth introducing if/when we add caching or a non-pg backend.
- **Query builder is a subset of PostgREST** — embedded selects assume to-one with `<table>_id` FKs; to-many needs `db.query(sql, values)`. Documented in `backend/src/config/db.ts`.
- **No migration runner** — feature SQL files are applied manually. A node-pg-migrate setup would be useful when the team grows past one person.
- **No structured background jobs** — reminders + cron tasks are not yet wired. Documented in `README.md` "Known follow-ups".
- **Single PM2 instance** — no clustering. `auth_sessions` is the only piece that would care, and the bcrypt-compare scan is already O(active-sessions). Move to clustered mode + Redis session store when we approach ~10k DAU.
- **No Docker / docker-compose** — deliberate. The deployment target is CloudPanel + PM2 + Nginx native; Docker adds operational complexity with no payoff at the current scale.
- **No `packages/` workspace split** — the prompt for the v0.X refactor asked for a monorepo with `packages/` + `shared/` + `tools/`, but the only code that's actually shared between front and back is the `types/` shape (8 strings — `Role`, `MANAGER_TIER`, etc.). Splitting into workspaces would multiply the build setup with negligible payoff. Revisit when there's >1 frontend or >1 backend service to share code across.

## File map (quick reference)

```
backend/
  src/
    server.ts                 boot, middleware chain, listener
    routes/                   one file per resource
    controllers/              one file per resource
    services/                 business logic
    repositories/             db access helpers (training only today)
    middleware/               auth, featureFlag, upload, errorHandler
    config/
      env.ts                  zod-validated env
      db.ts                   pg pool + query builder
      auth.local.ts           bcrypt + JWT
      storage.local.ts        filesystem + HMAC URLs
      logger.ts               pino
      bootstrap.ts            opt-in default admin
    types/index.ts            roles, tier helpers, httpError
  scripts/                    bootstrap-admin.mjs, seed-*.mjs
  ecosystem.config.cjs        PM2 definition

frontend/
  src/
    App.tsx                   routes
    main.tsx                  React mount + ErrorBoundary + Toaster
    config/env.ts             VITE_* validation
    context/AuthContext.tsx
    hooks/
      useFeatureFlags.tsx
      useInvalidate.ts
    components/               ProtectedRoute, Sidebar, Brand, …
    pages/                    one per route
    services/
      api.ts                  axios singleton
      session.ts              localStorage token store
    utils/                    fileUrl, …
    types/index.ts            mirrors backend roles + tier helpers

database/                     idempotent .sql migrations
scripts/                      deploy / update / backup / restore / healthcheck
nginx/                        example vhost snippet
docs/                         this folder
.github/                      CI, CODEOWNERS, PR template, dependabot
```
