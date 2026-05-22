# 06 · Fresh deployment / reset

Two reset modes. **Mode 1 (dev)** is safe and routine. **Mode 2 (prod)** is
destructive, manual, and gated. Neither runs automatically in CI/CD.

## What "old app data" actually is

| Kind                 | Where                                                        | Reset by                        |
| -------------------- | ------------------------------------------------------------ | ------------------------------- |
| Database rows/tables | `hireorbit_dev` (Neon) / `hireorbit_prod` (VPS)              | drop+rebuild schema             |
| Uploaded files       | dev `/tmp` (ephemeral) · prod `/var/lib/hireorbitai/uploads` | move aside / recreate           |
| Auth sessions        | `public.auth_sessions` table                                 | dropped with the schema         |
| Build artifacts      | `backend/dist`, `frontend/dist`, `*.tsbuildinfo`             | rebuilt by `update.sh` / Render |
| Caches               | in-memory only (permission cache, etc.)                      | cleared on process restart      |
| Logs                 | PM2 (`~/.pm2/logs`) · Render dashboard                       | not data; rotate/ignore         |
| Backups              | `~/backups/<stamp>/`                                         | retained; your safety net       |

There is no separate session store, Redis, or generated-file store to clean — the
DB + uploads dir are the whole of the persistent state.

---

## MODE 1 — DEV RESET (safe, routine)

Wipes `hireorbit_dev`, reloads the full schema, applies migrations, optionally
reseeds demo data. **Cross-platform — no `psql` needed.** Production is never
touched (the script hard-refuses any prod-looking URL).

From Windows (PowerShell), at the repo root:

```powershell
# Reads DATABASE_URL from the env file you point at:
node --env-file=backend\.env.development scripts\reset-dev.mjs --yes --seed
```

or, if `DATABASE_URL` is already in your shell environment:

```powershell
npm run db:reset:dev -- --yes --seed
```

Flags:

| Flag              | Effect                                                                |
| ----------------- | --------------------------------------------------------------------- |
| `--yes`           | skip the interactive "type reset-dev" confirmation                    |
| `--seed`          | run demo seed scripts (managers/recruiters/consultants) after rebuild |
| `--no-init`       | skip `database/init.sql`; build schema from migrations only           |
| `--force-unknown` | allow a `DATABASE_URL` that doesn't match known dev hints             |

What it does, in order:

1. Refuses if the URL contains `hireorbit_prod`, or doesn't look like dev.
2. `DROP SCHEMA public CASCADE; CREATE SCHEMA public;`
3. Loads `database/init.sql` (schema + reference data).
4. Runs `backend/migrations/` forward.
5. (`--seed`) seeds demo users.

Then redeploy dev (push to `dev`, or fire the Render deploy hooks). To create a
fresh admin instead of demo seeds:

```powershell
node --env-file=backend\.env.development backend\scripts\bootstrap-admin.mjs
```

> **Reset the dev DB from anywhere:** because it targets Neon, you can run this
> from your laptop, and CI's `dev.yml` keeps migrations current afterward.

---

## MODE 2 — FULL PRODUCTION RESET (destructive, manual)

> ⚠️ **This erases ALL production data.** Use it only for a deliberate
> "wipe the old app and deploy fresh" — e.g. decommissioning pilot data before
> go-live. It is **not** part of any deploy. Run it as a human, on the VPS, once.

### Gates (all required, or it refuses)

1. `CONFIRM=ERASE-PRODUCTION` in the environment
2. `--i-understand` as the first argument
3. `DATABASE_URL` must contain `hireorbit_prod`
4. A **full backup** (`backup.sh`) must succeed first — taken automatically
5. An interactive prompt to **type the database name** before it proceeds

### Run it

On the VPS, as the site user:

```bash
cd ~/hireorbitai
CONFIRM=ERASE-PRODUCTION bash scripts/reset-prod.sh --i-understand
# (it will ask you to type: hireorbit_prod)

# To also provision a fresh SUPER_ADMIN afterwards:
CONFIRM=ERASE-PRODUCTION SEED_ADMIN=true bash scripts/reset-prod.sh --i-understand
```

What it does, in order:

1. Validates all gates above.
2. Runs `scripts/backup.sh` → prints the rollback stamp.
3. `DROP SCHEMA public CASCADE; CREATE SCHEMA public;` (via `psql`).
4. Loads `database/init.sql`, then runs `migrate:up`.
5. Moves the old uploads dir aside (`*.pre-reset.<stamp>`) and recreates it empty.
6. (`SEED_ADMIN=true`) runs `bootstrap:admin`.
7. `pm2 restart hireorbitai-api` and curls `/api/health`.

### If the post-reset smoke test fails — rollback

The script prints the exact command; it's:

```bash
bash scripts/restore.sh <stamp-it-printed> all --force
pm2 restart hireorbitai-api --update-env
```

The old uploads are also preserved alongside the uploads dir until you delete them.

---

## "Fresh deployment" from nothing (clean VPS)

To stand up production cleanly on a new/empty VPS, you don't need Mode 2 — just
follow [01](01-vps-cloudpanel.md) then [02 §A](02-databases.md#a-production-db--hireorbit_prod-on-the-vps).
Mode 2 is specifically for wiping an **existing** prod database back to clean.

→ Next: [07 · Weekend release checklist](07-weekend-release-checklist.md)
