# Production deploy safety (dev → main)

Prod has **active users**. This deploy must never lose or overwrite their data.
This document is the checklist to run for the `dev → main` promote.

## Golden rules

1. **Never reset the prod database.** No `DROP`/`TRUNCATE`/recreate.
2. **Never run seed/mock scripts on prod.** `backend/scripts/seed-mock-data.mjs`,
   `seed-users.mjs`, `seed-leadership.mjs` are dev-only. They are not invoked by
   the deploy and must not be run by hand on the VPS.
3. **Never replace prod tables from dev.** Use migrations, not table copies/dumps
   from the dev database.
4. **All schema changes are additive or safely migrated** — `CREATE TABLE IF NOT
EXISTS`, `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`.
5. **Migrations are idempotent** — re-running is a no-op.
6. **Backfills only fill NULL/missing fields**, never overwrite existing values.
7. **If a column must become required**, ship it nullable first, backfill, then
   add the `NOT NULL` constraint in a _later_ deploy.

Preserve: users, roles, groups, invitations, consultants, recruiters, resumes,
jobs, applications, messages, training, feature flags.

## Migrations to run (this promote)

Run with `npm --prefix ~/hireorbitai/backend run migrate:up` (node-pg-migrate;
tracks applied migrations in `public.pgmigrations`, so already-applied ones are
skipped). Every one is additive + idempotent:

| Migration                               | Change                                                                                     | Tables affected                                      | Backfill?                                                                                                     |
| --------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `1748000000000_work-auth-documents`     | `CREATE TABLE IF NOT EXISTS work_auth_documents` + indexes                                 | new table only                                       | none                                                                                                          |
| `1748100000000_ai-usage-logs`           | `CREATE TABLE IF NOT EXISTS ai_usage_logs` + indexes                                       | new table only                                       | none                                                                                                          |
| `1748200000000_resume-parsed-profile`   | `ADD COLUMN IF NOT EXISTS resumes.parsed_profile jsonb` (nullable)                         | resumes (additive)                                   | none                                                                                                          |
| `1748300000000_consultant-onboarded-at` | `ADD COLUMN IF NOT EXISTS consultants.onboarded_at` (nullable) + BEFORE-UPDATE trigger     | consultants (additive)                               | **yes — NULL-only**: `SET onboarded_at = created_at WHERE marketing_status='ACTIVE' AND onboarded_at IS NULL` |
| `1749000000000_invitation_parent`       | `ADD COLUMN IF NOT EXISTS` parent_user_id / assigned_mode (default `'auto'`) / assigned_by | invitations (additive)                               | none                                                                                                          |
| `1750000000000_dev-settings`            | `CREATE TABLE IF NOT EXISTS dev_settings`                                                  | new table only                                       | none                                                                                                          |
| `1751000000000_developer-capabilities`  | `ADD COLUMN IF NOT EXISTS users.capabilities text[] NOT NULL DEFAULT '{}'`                 | users (additive; default fills existing rows safely) | none (default)                                                                                                |

The single backfill (`onboarded_at`) is **NULL-only** — it never overwrites an
existing value, satisfying rule #6/#10.

### Manual SQL file (apply only if not already applied)

`database/jobs-strict-4-sources.sql` is a **job-ingestion config** migration
(`source_companies` table only). It is idempotent (`ON CONFLICT … DO UPDATE`) and
touches **no user data** — the `DELETE FROM jobs …` block is intentionally
commented out. It only reconciles the active job sources to the strict 4-source
policy (LinkedIn / Dice / Monster / CareerBuilder). If prod is already on the
4-source policy, skip it. To apply:

```bash
set -a; source ~/hireorbitai/backend/.env; set +a
psql "$DATABASE_URL" -f ~/hireorbitai/database/jobs-strict-4-sources.sql
```

### Tables affected (summary)

- **New tables:** `work_auth_documents`, `ai_usage_logs`, `dev_settings`.
- **New columns (additive):** `resumes.parsed_profile`, `consultants.onboarded_at`,
  `invitations.{parent_user_id,assigned_mode,assigned_by}`, `users.capabilities`.
- **Config-only data change:** `source_companies` (if the manual SQL is applied).
- **No destructive changes. No required-column changes. No data overwrites.**

The Phase 13 submission reports add **no migration** — they read the existing
`applications` table.

## Pre-deploy checks

```bash
set -a; source ~/hireorbitai/backend/.env; set +a

# 1. Snapshot current row counts (save the output to compare after deploy).
psql "$DATABASE_URL" -f ~/hireorbitai/scripts/deploy-rowcounts.sql | tee ~/predeploy-rowcounts.txt

# 2. Confirm a fresh backup exists (and is restorable). See scripts/ops.sh.
bash ~/hireorbitai/scripts/ops.sh backup
bash ~/hireorbitai/scripts/ops.sh verify     # restore-drill into a throwaway DB

# 3. Dry-run / staging: ideally apply migrate:up against a copy of the prod dump
#    first (the ops.sh verify drill already loads the latest dump into a temp DB —
#    run migrate:up there to confirm the migrations apply cleanly).
```

Do not proceed if the backup step fails or `verify` can't restore.

## Deploy

```bash
# From the working machine, promote dev → main (this triggers the GH Action):
git push hireorbitai chore/full-refactor:main   # or: git push origin dev:main per your flow

# On the VPS, after the action finishes building:
set -a; source ~/hireorbitai/backend/.env; set +a
npm --prefix ~/hireorbitai/backend run migrate:up
# (apply the manual jobs-strict SQL only if needed — see above)
pm2 reload hireorbitai-backend
```

## Post-deploy checks

```bash
set -a; source ~/hireorbitai/backend/.env; set +a

# 1. Integrity: presence + linkage. Any 'FAIL' row is a blocker.
psql "$DATABASE_URL" -f ~/hireorbitai/scripts/postdeploy-verify.sql

# 2. Row counts must be >= the pre-deploy snapshot for every user-data table.
psql "$DATABASE_URL" -f ~/hireorbitai/scripts/deploy-rowcounts.sql | diff - ~/predeploy-rowcounts.txt || true

# 3. App health.
curl -fsS https://<prod-host>/api/health
```

Then verify by hand:

- [ ] **Active users still exist** (`active_users_present` = pass).
- [ ] **Login works** — sign in as a known prod account.
- [ ] **Roles still correct** — the `role_*` info rows match the pre-deploy snapshot;
      `active_super_admin_present` = pass.
- [ ] **Consultants / recruiters / applications / resumes still linked** — all
      `orphan_*` checks = pass (0 orphans).
- [ ] **Feature flags still present** (`feature_flags_present` = pass) and toggles
      behave as before.
- [ ] **Invitations still valid** — open a pending invite link; it still previews
      and accepts.
- [ ] **New columns applied** (`capabilities_column_exists` = pass).

## Rollback plan

The migrations are additive, so a code rollback alone is safe — the extra
columns/tables are simply unused by the previous app version.

1. **Code rollback:** redeploy the previous `main` commit (the repo has
   `.github/workflows/rollback.yml`), or `git revert` the promote commit and push
   to `main`. PM2 reloads the prior build.
2. **The additive columns/tables can stay** — they don't break the old code. Do
   **not** drop them to "undo" (dropping `users.capabilities` etc. would be the
   only destructive step; avoid it).
3. **If a restore is truly required** (data corruption, not just bad code), use
   the pre-deploy backup taken above:
   ```bash
   bash ~/hireorbitai/scripts/restore.sh <stamp> db --force
   ```
   This is the last resort — prefer code rollback, since the schema changes are
   backward-compatible.
4. The single backfill (`onboarded_at`) is reversible-by-irrelevance: it only set
   a previously-NULL analytics timestamp; the old code ignores the column.
