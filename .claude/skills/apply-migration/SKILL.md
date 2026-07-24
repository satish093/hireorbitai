---
name: apply-migration
description: Walk the user through applying a SQL migration on the VPS. Auto-invoke when the user says "apply migration", "run database/X.sql on prod", or asks how to ship a SQL change.
trigger:
  - 'apply migration'
  - 'run migration on prod'
  - 'psql production'
  - 'deploy database'
---

# Apply migration

You can't run `psql` from inside the agent — `Bash(psql:*)` is denied at the project settings level, and the agent shell doesn't have `$DATABASE_URL` populated anyway. The right flow is to hand the user a copy-pasteable shell snippet they run themselves on the VPS.

## Steps

1. **Identify the migration.** Either `database/<file>.sql` (manual flat-file migrations) or `backend/migrations/<file>.sql` (`node-pg-migrate`-tracked).
2. **Confirm it's idempotent.** Look for `create … if not exists`, `add column if not exists`, `drop trigger if exists` before any DDL. If the migration isn't idempotent, flag it before suggesting a run.
3. **Hand the user the snippet.** Format:

   ```bash
   ssh user@vps   # if not already there

   set -a
   source ~/hireorbitai/backend/.env
   set +a

   # For flat files:
   psql "$DATABASE_URL" -f ~/hireorbitai/database/<file>.sql

   # For node-pg-migrate:
   npm --prefix ~/hireorbitai/backend run migrate:up
   ```

4. **Sanity check.** Suggest `psql "$DATABASE_URL" -c '\\conninfo'` first so the user confirms they're hitting the right database.

5. **Verify after.** Suggest a one-line check that the migration actually landed — e.g. `psql "$DATABASE_URL" -c '\\d+ public.<table>'` or a `SELECT count(*) FROM pg_indexes WHERE indexname = '<index_name>'`.

## What not to do

- Don't run `psql` via the Bash tool. It's denied.
- Don't suggest `ssh` from the agent. Also denied.
- Don't suggest sourcing `.env` once and assuming it persists across the user's shell sessions — the snippet must be self-contained.
- Don't suggest applying anything via `update.sh` — that script never runs migrations, only code deploys.
