---
name: database
description: Rules for using the PostgREST-compat shim and writing migrations.
applies_to:
  - backend/src/**
  - database/**
  - backend/migrations/**
---

# Database rules

## The shim — `backend/src/config/db.ts`

Controllers consume Postgres via a Supabase-style chain:

```ts
const { data, error } = await db.from('users').select('id, email').eq('id', x).maybeSingle();
```

Supported methods: `.eq .neq .gt .gte .lt .lte .is .in .like .ilike .contains .overlaps .or .order .range .limit .single .maybeSingle`. `.or()` accepts nested `and(...) / or(...) / not.` groups. Embedded joins work too: `'recruiter:recruiters!recruiter_id(id, team)'`.

**Don't bypass it.** All values are parameterized via `$N` placeholders, all column names go through `qi()` which whitelists `[a-zA-Z_][a-zA-Z0-9_]*`. Inlining identifiers or values into a raw query string defeats those guards.

If you need raw SQL (very rare), use the exported `pool` from `db.ts` directly with `pool.query('… WHERE x = $1', [v])` — never string-concatenate values.

## Adding columns

Every controller that touches a column added by a migration that may not be applied yet has retry-and-strip logic. New columns should follow the same pattern:

1. Add the column in a migration.
2. In the controller, try the full insert/update first.
3. On `/schema cache|column .* does not exist/i`, peel the new field from the payload and retry.

This lets the backend deploy ahead of the migration without 500s. Don't rip that out.

## Migrations

Two systems coexist:

- `database/*.sql` — historical baseline. Applied manually with `psql -f`. Order matters: `schema.sql` → `auth-hardening.sql` → feature SQL files (`tasks.sql`, `training.sql`, etc.). README has the canonical order. Use this for setup, not for new changes.
- `backend/migrations/*.sql` — `node-pg-migrate`-tracked. Run with `npm --prefix backend run migrate:up`. **Use this for any NEW migration going forward.** File names are timestamped; the migration runner records applied migrations in `public.pgmigrations`.

When you create a new migration, make it idempotent: `create table if not exists`, `add column if not exists`, `create unique index if not exists`. Re-running should be safe.

## Don't run psql in the agent

The shell does not have `$DATABASE_URL` populated unless `.env` is sourced. Asking the user to run migrations on the VPS is the right flow:

```bash
set -a; source ~/hireorbitai/backend/.env; set +a
psql "$DATABASE_URL" -f ~/hireorbitai/database/<file>.sql
```

Never include `Bash(psql:*)` in the project allow-list.
