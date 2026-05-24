# HireOrbit AI — Deployment

Production-safe deployment architecture: a **free Render dev environment** for
testing, **production on the existing VPS + CloudPanel**, **two fully separated
databases**, and a safe weekend release flow.

> **Just want to deploy or reset production?** → [00 · Production Runbook](00-production-runbook.md) — self-contained, copy-paste steps.
> New here (learning the architecture)? Read **01 → 02 → 03 → 04**, then use **05/06/07** as runbooks.

| #   | Guide                                                        | What it covers                                                    |
| --- | ------------------------------------------------------------ | ----------------------------------------------------------------- |
| 00  | [**Production Runbook**](00-production-runbook.md)           | **Fresh VPS deploy + full data wipe — one self-contained doc**    |
| 01  | [VPS + CloudPanel](01-vps-cloudpanel.md)                     | Site, Node app, Nginx, SSL, PM2, env vars                         |
| 02  | [Databases](02-databases.md)                                 | `hireorbit_prod` (VPS) + `hireorbit_dev` (Neon), separation guard |
| 03  | [Render dev hosting](03-render-dev-hosting.md)               | Free backend + frontend, env vars, deploy hooks                   |
| 04  | [GitHub Actions](04-github-actions.md)                       | Exact secrets/variables for `dev.yml` + `deploy-production.yml`   |
| 05  | [Deploy & rollback](05-deploy-and-rollback.md)               | Dev flow, weekend prod flow, rollback                             |
| 06  | [Fresh deployment / reset](06-fresh-reset.md)                | Dev reset (Mode 1) + full prod reset (Mode 2)                     |
| 07  | [Weekend release checklist](07-weekend-release-checklist.md) | Copy-paste checklist                                              |

## Architecture

```
LOCAL (Windows + VS Code + Claude Code)
  └─ feature/*  ──open PR──▶  dev  ─────────────┐
                                                │ push to dev
                                                ▼
                          ┌──────────────────────────────────────┐
                          │ GitHub Actions · dev.yml               │
                          │   verify → verify:full                 │  ✗ test fail → STOP (no deploy)
                          │   → migrate Neon (hireorbit_dev)       │
                          │   → POST Render deploy hooks            │
                          └──────────────────────────────────────┘
                                                │
                        ┌───────────────────────┴───────────────────────┐
                        ▼                                                 ▼
              Render Static Site                              Render Web Service (free)
              hireorbit-web-dev  ───── calls /api ─────▶      hireorbit-api-dev
              (frontend, always-on)                           (backend, cold-starts ~30s)
                                                                          │
                                                                          ▼
                                                   Neon free Postgres · hireorbit_dev
                                                   (SEPARATE physical server)

  manual test on the Render URLs → happy → merge dev → main
                                                │ push to main (explicit, gated)
                                                ▼
                          ┌──────────────────────────────────────┐
                          │ GitHub Actions · deploy-production.yml │
                          │   SSH → scripts/update.sh              │
                          │   pull → build → migrate → pm2 reload  │
                          │   → curl /api/health                    │
                          └──────────────────────────────────────┘
                                                ▼
                       VPS + CloudPanel (Nginx + PM2 + Node 22)
                       Postgres · hireorbit_prod  (local socket, never internet-exposed)
```

## Why this shape (trade-offs)

- **Dev DB on Neon, not the VPS.** Render's free tier has **no fixed outbound
  IP**, so a Render→VPS Postgres connection would require exposing port 5432 to
  the internet — on the _same_ Postgres server that hosts production. Neon puts
  the dev DB on a separate machine, so "dev can never touch prod" is guaranteed
  by physics, not config. (If you'd rather host `hireorbit_dev` on the VPS, see
  the alternative in [02](02-databases.md) — the rest of the setup is identical.)
- **Render free web service cold-starts** (~30s after 15 min idle). Fine for a
  dev/test target; the frontend static site is always-on so the UI loads instantly
  and the first API call wakes the backend.
- **Deploy via deploy-hook, not Render auto-deploy.** `dev.yml` only fires the
  Render hooks _after_ `verify:full` is green, so a failing test never ships to dev.
- **Production pipeline is unchanged.** `deploy-production.yml` + `scripts/update.sh`
  already worked; we only _added_ a startup DB guard and reset tooling around it.

## Environment separation at a glance

|                         | Local                              | Dev (Render)                                 | Production (VPS)               |
| ----------------------- | ---------------------------------- | -------------------------------------------- | ------------------------------ |
| `NODE_ENV`              | `development`                      | `development`                                | `production`                   |
| Database                | Neon `hireorbit_dev` (or local PG) | Neon `hireorbit_dev`                         | VPS `hireorbit_prod`           |
| Frontend `VITE_API_URL` | `http://localhost:4000/api`        | `https://hireorbit-api-dev.onrender.com/api` | `https://hireorbitai.com/api`  |
| AI provider             | `stub`                             | `stub`                                       | `subscription`                 |
| Job ingestion           | `JOB_SOURCES_MOCK=true`            | `true`                                       | `false` (real keys)            |
| Uploads                 | `./.uploads-dev`                   | `/tmp` (ephemeral)                           | `/var/lib/hireorbitai/uploads` |
| Env source              | `backend/.env`                     | Render dashboard                             | `backend/.env` on VPS          |

### The cross-environment DB guard

`backend/src/config/env.ts` refuses to boot when `NODE_ENV` and `DATABASE_URL`
disagree about environment. It classifies by the parsed **host + database name**
(never the raw connection string, so a password can't skew the verdict):

- `NODE_ENV=production` → the DB name **must** contain `hireorbit_prod`; a dev
  DB (`hireorbit_dev`/`neon.tech`) **or any unrecognized DB** → **exit**
- `NODE_ENV≠production` + a `hireorbit_prod` DB → **exit**

Controlled by `DB_GUARD` (`enforce` default / `warn` / `off`). This is the
last line of defence against a mis-pasted connection string. Keep DB names
following the `hireorbit_prod` / `hireorbit_dev` convention and it just works;
if production genuinely uses a different name, set `DB_GUARD=off`.

## Files this architecture adds

```
render.yaml                              Render Blueprint (dev backend + frontend)
.github/workflows/dev.yml                push-to-dev: verify:full → migrate → deploy
backend/.env.production.example          prod env template (committed, placeholders)
backend/.env.development.example         dev env template
frontend/.env.production.example         frontend prod VITE template
frontend/.env.development.example        frontend dev VITE template
scripts/reset-dev.mjs                    Mode 1 — dev reset (cross-platform, Node)
scripts/reset-prod.sh                    Mode 2 — full prod reset (gated, VPS)
backend/src/config/env.ts                + DB_GUARD cross-env guard  (edited)
docs/deployment/*                        these guides
```

Pre-existing and reused as-is: `scripts/update.sh`, `scripts/backup.sh`,
`scripts/restore.sh`, `scripts/healthcheck.sh`, `.github/workflows/deploy-production.yml`,
`.github/workflows/ci.yml`.
