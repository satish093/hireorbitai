# Migrations

This directory is owned by [`node-pg-migrate`](https://github.com/salsita/node-pg-migrate). Every schema change after the v0 baseline lives here.

## Workflow

```bash
# Create a new migration file. The `<slug>` becomes part of the filename;
# the runner prefixes a millisecond timestamp so ordering is unambiguous.
npm run migrate:create add-applications-archived-status

# Edit the new file under backend/migrations/<timestamp>_add-applications-archived-status.sql
# Both UP and DOWN sections must be filled in (the runner enforces this).

# Apply pending migrations against the database in DATABASE_URL.
npm run migrate:up

# Roll back the most recent migration.
npm run migrate:down
```

## Relationship with /database/\*.sql

The 30+ files under [`/database/`](../../database/) are the **v0 baseline**. They're idempotent and have been applied manually via `psql -f` on every existing environment.

On any host that already has the baseline applied, run once:

```bash
npm run migrate:up
```

The first migration (`1700000000000_baseline.sql`) is a no-op that just registers the row in `pgmigrations`. After that, only new (post-baseline) migrations run.

For brand-new databases, the canonical install sequence is:

```bash
# 1. Apply the baseline manually.
psql "$DATABASE_URL" -f database/schema.sql
psql "$DATABASE_URL" -f database/auth-hardening.sql
psql "$DATABASE_URL" -f database/admin-user-management.sql
psql "$DATABASE_URL" -f database/feature-flags.sql
# … plus any feature modules you want (tasks.sql, training.sql, messages.sql, …)

# 2. Hand off to the migration runner.
cd backend && npm run migrate:up
```

## SQL format

```sql
-- Up Migration
ALTER TABLE public.applications ADD COLUMN archived_at timestamptz;

-- Down Migration
ALTER TABLE public.applications DROP COLUMN archived_at;
```

`node-pg-migrate` requires both an `Up` and a `Down` section. If down is genuinely irreversible (data loss), set the down to a `RAISE EXCEPTION` so a contributor reaching for `migrate:down` gets a loud failure instead of silent corruption.

## What NOT to put here

- Data backfills > 1000 rows — write a one-off script in `backend/scripts/` instead so the runner doesn't time out.
- Anything that needs to run with downtime — coordinate manually rather than letting the runner do it on an automated deploy.
- `seed-*.sql` style data inserts — those belong under `database/` or `backend/scripts/`.
