# 03 · Free dev hosting on Render

The `dev` branch deploys to two **free** Render services:

- **`hireorbit-api-dev`** — Express backend, free _Web Service_ (cold-starts ~30s
  after 15 min idle).
- **`hireorbit-web-dev`** — React/Vite frontend, free _Static Site_ (always-on).

The dev database is **Neon `hireorbit_dev`** (see [02](02-databases.md)). Render
holds no database.

## Why Render (vs alternatives)

|                                  | Render free    | Vercel/Netlify    | Fly.io           |
| -------------------------------- | -------------- | ----------------- | ---------------- |
| Express backend, always free     | ✅ web service | ❌ functions only | ⚠️ trial credits |
| Static frontend, free            | ✅             | ✅                | ⚠️               |
| GitHub branch deploy             | ✅             | ✅                | ⚠️ CLI           |
| One dashboard for both halves    | ✅             | split             | ✅               |
| Windows-friendly (no CLI needed) | ✅             | ✅                | ❌ flyctl        |

Render hosts both halves of a React+Express monorepo for free with branch-based
GitHub deploys and no local CLI — the best fit here. Cold-start on the backend is
the only real downside, and it's irrelevant for a test environment.

## Setup — Option A: Blueprint (fastest)

The repo ships `render.yaml`. In Render: **New → Blueprint → connect the repo →
select `render.yaml`**. It creates both services on the `dev` branch with
`autoDeploy: true` (Render redeploys on every push to `dev`) and the right
build/start commands. Then jump to **"Set the env vars"** below to fill
`sync:false` values.

> If the Blueprint import errors on a field, use Option B — the field names in
> Render's spec drift occasionally. The manual settings below are authoritative.

## Setup — Option B: by hand (reliable)

### Backend — Web Service

**New → Web Service → connect repo →** branch **`dev`**, runtime **Node**:

- **Build command:** `npm ci && npm run shared:build && npm --prefix backend run build`
- **Start command:** `node backend/dist/server.js`
- **Health check path:** `/health`
- **Auto-Deploy:** **On** (Render redeploys on every push to `dev`)
- **Instance type:** Free

### Frontend — Static Site

**New → Static Site → connect repo →** branch **`dev`**:

- **Build command:** `npm ci && npm run shared:build && npm --prefix frontend run build`
- **Publish directory:** `frontend/dist`
- **Auto-Deploy:** **On**
- **Redirect/Rewrite rule:** Source `/*` → Destination `/index.html`, Action
  **Rewrite** (SPA client routing).

## Set the env vars

After the services exist you'll know their `*.onrender.com` URLs. Set them so the
two halves point at each other (chicken-and-egg: create first, then fill URLs).

**`hireorbit-api-dev` → Environment:**

| Key                                                   | Value                                                                |
| ----------------------------------------------------- | -------------------------------------------------------------------- |
| `NODE_ENV`                                            | `development` ← _not_ production, or the DB guard rejects the dev DB |
| `DB_GUARD`                                            | `enforce`                                                            |
| `DATABASE_URL`                                        | the Neon `hireorbit_dev` string (`…/hireorbit_dev?sslmode=require`)  |
| `DATABASE_SSL`                                        | `require`                                                            |
| `CORS_ORIGIN`                                         | `https://hireorbit-web-dev.onrender.com` (the static-site URL)       |
| `APP_URL`                                             | `https://hireorbit-web-dev.onrender.com`                             |
| `FRONTEND_URL`                                        | `https://hireorbit-web-dev.onrender.com`                             |
| `JWT_SECRET` / `COOKIE_SECRET` / `STORAGE_URL_SECRET` | click **Generate** (32+ chars each)                                  |
| `UPLOADS_DIR`                                         | `/tmp/uploads` (ephemeral — fine for dev)                            |
| `TRAINING_AI_PROVIDER`                                | `stub` (zero API spend on dev; change to `api` + set key to enable)  |
| `ANTHROPIC_API_KEY`                                   | (optional) `sk-ant-…` key — enables real AI matching/scoring on dev  |
| `JOB_SOURCES_MOCK`                                    | `true` (zero API spend)                                              |
| `BREVO_MOCK`                                          | `true` (log emails instead of sending — zero spend)                  |
| `BREVO_API_KEY`                                       | any 10+ char placeholder (required by schema; unused when mocked)    |
| `DEV_TOOLS`                                           | `true` — role/user switch + `/dev` test panel (ignored in prod)      |
| `RUN_SCHEDULER`                                       | `false` — skip background workers to fit the free instance's RAM     |
| `PORT`                                                | leave unset — Render injects it; the app reads `process.env.PORT`    |

**`hireorbit-web-dev` → Environment:**

| Key              | Value                                                          |
| ---------------- | -------------------------------------------------------------- |
| `VITE_API_URL`   | `https://hireorbit-api-dev.onrender.com/api` (note the `/api`) |
| `VITE_DEV_TOOLS` | `true` — shows the floating dev toolbar + `/dev` panel         |

> `VITE_*` is baked at **build** time, so changing `VITE_API_URL` requires a
> redeploy of the frontend, not just a restart.

## Deploys (auto, on push to `dev`)

`autoDeploy: true` — Render's native GitHub integration rebuilds both services
on every push to the `dev` branch. No GitHub Action or deploy hook is needed
(the old `dev.yml` workflow was removed). Pushing to `main` is the **production
VPS** deploy and never touches Render.

To gate dev deploys behind tests instead, set `autoDeploy: false` and trigger a
deploy hook from CI — but for a throwaway dev box, auto-deploy is the clean default.

## First deploy + smoke

1. **Initialise the Neon dev DB once** (schema → migrations → seed users → mock
   data) from your machine, pointed at the Neon `hireorbit_dev` string:
   ```bash
   node --env-file=backend/.env scripts/reset-dev.mjs --yes --seed
   ```
   This also applies the `dev_settings` migration the test panel needs. After
   the first init, normal deploys don't touch the DB; apply later migrations with
   `npm --prefix backend run migrate:up`.
2. Push to `dev` (or click **Manual Deploy** on each service).
3. Open `https://hireorbit-web-dev.onrender.com` — first load wakes the backend
   (~30s), then the app works. The **DEV toolbar** appears bottom-left; use it to
   switch roles/users without logging in.
4. Backend health: `https://hireorbit-api-dev.onrender.com/health` → `{"ok":true}`.

## Troubleshooting

| Symptom                                                           | Cause / fix                                                                                                              |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Backend boot loops, logs say "Database environment guard tripped" | `DATABASE_URL` doesn't contain `hireorbit_dev`/`neon.tech`, or `NODE_ENV=production`. Fix the env.                       |
| Backend exits "Invalid environment configuration"                 | A required var missing — Render logs list each one. Common: `STORAGE_URL_SECRET`/`JWT_SECRET` < 32 chars (use Generate). |
| Frontend loads but every API call fails CORS                      | `CORS_ORIGIN` on the backend ≠ the static-site URL exactly (scheme + host, no trailing slash).                           |
| API calls 404 / hit the wrong host                                | `VITE_API_URL` wrong or missing the `/api` suffix; rebuild frontend.                                                     |
| First request after idle times out                                | Free web service cold start (~30s). Retry; it's expected.                                                                |
| `pg` SSL error connecting to Neon                                 | `DATABASE_SSL=require` and the URL ends with `?sslmode=require`.                                                         |
| Realtime/SSE doesn't stream                                       | Render free supports SSE; ensure the frontend uses `VITE_API_URL` and the backend is awake.                              |

→ Next: [04 · GitHub Actions](04-github-actions.md)
