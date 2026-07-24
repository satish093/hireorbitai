# Dual-environment architecture (Production + Development)

HireOrbit AI runs two environments from one codebase:

|                          | **Production**                             | **Development**                                                                      |
| ------------------------ | ------------------------------------------ | ------------------------------------------------------------------------------------ |
| Host                     | self-hosted VPS (CloudPanel + PM2 + nginx) | free host (Render/Fly) + Neon free Postgres + static frontend (Netlify/Vercel/Pages) |
| Auth                     | real JWT login                             | real JWT **plus** one-click role/user switching (no password)                        |
| Data                     | live Postgres                              | seeded mock data, resettable                                                         |
| Integrations             | real AI / email / scraping                 | mocked (zero spend)                                                                  |
| Dev toolbar / test panel | **absent** (force-disabled + tree-shaken)  | enabled                                                                              |
| Background workers       | on                                         | off by default (low RAM)                                                             |

The two are kept apart by **one derived flag**, force-disabled in production:

- Backend: `env.devTools = DEV_TOOLS && NODE_ENV !== 'production'` ([config/env.ts](../backend/src/config/env.ts)). Dev routes are gated by `requireDevTools`, which **404s** when off — invisible in prod.
- Frontend: `config.isDevTools = import.meta.env.DEV && VITE_DEV_TOOLS === 'true'` ([config/env.ts](../frontend/src/config/env.ts)). All dev code lives under `frontend/src/dev/**` and is reached only behind an `import.meta.env.DEV ? lazy(...) : null` guard, so Vite **tree-shakes it out** of production builds. `npm --prefix frontend run build:check` asserts `dist/` contains no dev markers.

## Development features

### Role / user switching (no login)

The floating **dev toolbar** (bottom-left) lists every seeded user and lets you become any of them in one click. It calls `POST /auth/dev/login { userId }`, which mints a **real session for a real seeded user** via the same impersonation primitive the admin flow uses ([auth.local.ts](../backend/src/config/auth.local.ts) `createSessionForUser`). Because the session is real, the full production RBAC pipeline (`requireAuth`, `requireRole`, feature gates, `ProtectedRoute`) runs unchanged — **dev RBAC == prod RBAC**. The session is swapped in place (no page reload).

### Super-Admin test panel — `/dev`

A DEV-only page to store/edit test integration configs (AI keys, SMTP, scraper, experimental flags) in a dev-only `dev_settings` table via `GET/PUT /dev/integrations`. Triple-gated: `requireDevTools` + `requireAuth` + `requireRole('SUPER_ADMIN')`. Lets you trial settings without editing `.env` or touching production. Read back in dev code paths via `getDevSetting()`.

### Mock data

`backend/scripts/seed-mock-data.mjs` seeds cross-linked clients, vendors, jobs, applications, interviews, messages, reminders, and recruiter activity so every dashboard shows realistic data. Idempotent.

## Local setup

```bash
cp backend/.env.development.example backend/.env          # set Neon DATABASE_URL
cp frontend/.env.development.example frontend/.env.development

# reset + seed the dev database (schema → migrations → users → mock data)
node --env-file=backend/.env scripts/reset-dev.mjs --yes --seed

npm --prefix backend run dev        # API on :4000  (DEV_TOOLS=true, RUN_SCHEDULER=false)
npm --prefix frontend run dev       # Vite on :5173 (toolbar appears bottom-left)
```

Reseed mock data anytime: `npm --prefix backend run seed:mock`.

## Free hosting (no domain required)

| Layer        | Recommendation                                              | Notes                                                                                                                                                                                                                                                            |
| ------------ | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Database** | **Neon** free Postgres                                      | DB name must contain `hireorbit_dev` (or host `neon.tech`) or the DB guard rejects it.                                                                                                                                                                           |
| **Backend**  | **Render** free Web Service (512 MB) — or **Fly.io** (1 GB) | Node 22. Set `RUN_SCHEDULER=false`, `NODE_ENV=development`, `DEV_TOOLS=true`, `BREVO_MOCK=true`, `JOB_SOURCES_MOCK=true`, `TRAINING_AI_PROVIDER=stub`. Optionally `--max-old-space-size=256`. Free tier spins down when idle (first request after idle is slow). |
| **Frontend** | **Netlify / Vercel / Cloudflare Pages** (static)            | Build `npm --prefix frontend run build`; set `VITE_API_URL` → the backend URL and `VITE_DEV_TOOLS=true`. No backend cost.                                                                                                                                        |

Render/Vercel auto-deploy from the repo on push — no GitHub Action required (the old `deploy-dev.yml` was removed). Lowest-RAM config: scheduler off, integrations mocked, single instance.

## Security guarantees

- `env.devTools` is `false` whenever `NODE_ENV=production` — `/auth/dev/*` and `/dev/*` return 404; no impersonation, no test panel.
- Frontend dev code is tree-shaken from prod builds (verified by `check-dist-clean.mjs`).
- Production auth/RBAC code paths are untouched; dev reuses the real session pipeline (no second, weaker auth path).
- `/dev/integrations` is additionally `SUPER_ADMIN`-gated; test keys live only in the dev database.
- All seed scripts refuse to run against a production DB unless `SEED_ALLOW_PROD=true`.
