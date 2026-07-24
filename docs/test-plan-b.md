# Testing Plan B without spending money

The Plan B job-ingestion config (LinkedIn paid + JSearch free + Adzuna free) requires real API subscriptions to run end-to-end. Mock mode replaces those API calls with synthetic data so you can validate the entire pipeline — migration → scheduler → upsert → frontend filtering — for $0.

## What mock mode does

When `JOB_SOURCES_MOCK=true` is set in `backend/.env`:

- `fetchLinkedIn` returns 3 fake jobs per LinkedIn title slug.
- `fetchJSearch` returns 4 fake jobs per JSearch query slug, with the `publisher` field set correctly based on any `site:dice.com` / `site:monster.com` / `site:careerbuilder.com` operator.
- `fetchAdzuna` returns 5 fake jobs.
- **No HTTP calls are made**, so no API key is required to be valid and no quota is consumed.

Every mock row has:

- `external_id` prefixed with `MOCK-` (deterministic, stable across re-runs so dedup works).
- `title` suffixed with ` (TEST DATA)`.
- `description` starting with `[MOCK] This is synthetic data for Plan B testing.`.
- `apply_url` pointing at `https://example.com/mock-job/<external_id>` — harmless 404s if clicked.

## Test walkthrough

```bash
# 1. SSH to the VPS
ssh hireorbitai@srv1662902

# 2. Enable mock mode
cd ~/hireorbitai/backend
# Edit .env — set or add:
#   JOB_SOURCES_MOCK=true
# Don't need real RAPIDAPI_KEY / ADZUNA_APP_ID values when mock is on.

# 3. Restart the backend to pick up the env var change
pm2 reload backend

# 4. Apply the Plan B migration if you haven't already
set -a; source ~/hireorbitai/backend/.env; set +a
psql "$DATABASE_URL" -f ~/hireorbitai/database/enable-jobs-plan-b.sql

# 5. Trigger an immediate sync (don't wait for the scheduler tick)
ADMIN_JWT="<paste your admin bearer token>"
curl -X POST -H "Authorization: Bearer $ADMIN_JWT" \
  https://hireorbitai.com/api/jobs/sync

# 6. Check that synthetic jobs landed
psql "$DATABASE_URL" -c "
  SELECT source, publisher, title, external_id
  FROM public.jobs
  WHERE external_id LIKE 'MOCK-%'
  ORDER BY created_at DESC
  LIMIT 30;"

# Expected: rows from
#   source=linkedin    publisher=LinkedIn
#   source=jsearch     publisher=Dice         (from the site:dice.com slug)
#   source=jsearch     publisher=Monster      (from site:monster.com)
#   source=jsearch     publisher=CareerBuilder (from site:careerbuilder.com)
#   source=jsearch     publisher=Dice/Monster  (from the dual Java slug)
#   source=adzuna      publisher=null
```

## Verify the frontend filters work

```
1. Open https://hireorbitai.com/jobs
2. Search for "TEST DATA" — every mock job's title has this suffix.
3. Open one — confirm the description starts with "[MOCK]".
4. Use the publisher / source filters to confirm jobs are tagged correctly.
```

## Tail the logs to watch the sync

```bash
pm2 logs backend --lines 100 | grep -E 'jobIngestion|mock mode|jobs-sync'
```

Look for:

```
jobIngestion: mock mode — returning synthetic jobs  source=linkedin slug="Software Engineer"
jobIngestion: mock mode — returning synthetic jobs  source=jsearch slug="software engineer site:dice.com"
jobIngestion: mock mode — returning synthetic jobs  source=adzuna slug=null
```

If you see the real-API code path instead (HTTP errors, "RAPIDAPI_KEY not set", quota warnings), the env var didn't load — re-check `JOB_SOURCES_MOCK` spelling and `pm2 reload`.

## Cleanup after testing

```bash
# 1. Disable mock mode
# Edit backend/.env — set:
#   JOB_SOURCES_MOCK=false
# (or remove the line entirely; default is off)

# 2. Restart the backend
pm2 reload backend

# 3. Delete the mock rows from the DB
psql "$DATABASE_URL" -c "DELETE FROM public.jobs WHERE external_id LIKE 'MOCK-%';"
```

## When you're ready to test the REAL pipeline

```bash
# Set JOB_SOURCES_MOCK=false
# Add real keys:
#   RAPIDAPI_KEY=<your key after subscribing to LinkedIn-Job-Search-API Basic>
#   ADZUNA_APP_ID=<your id>
#   ADZUNA_APP_KEY=<your key>
#   LINKEDIN_TITLES=Software Engineer|Data Engineer|Full Stack Developer
#   JOB_SYNC_INTERVAL_MS=86400000

pm2 reload backend
curl -X POST -H "Authorization: Bearer $ADMIN_JWT" \
  https://hireorbitai.com/api/jobs/sync
```

The first real sync should cost roughly 8 API calls total (3 LinkedIn + 4 JSearch + 1 Adzuna). Watch the RapidAPI dashboard to confirm usage matches expectations.

## Safety notes

- Mock mode is **off by default** (`JOB_SOURCES_MOCK=false` in the example env). Production won't accidentally serve fake jobs unless someone explicitly flips the flag.
- Mock rows live in the same `public.jobs` table as real rows. The `external_id LIKE 'MOCK-%'` cleanup query is the only safe automated way to remove them — never `TRUNCATE jobs` or `DELETE FROM jobs WHERE created_at > X`.
- Only the 3 Plan B drivers are mocked (LinkedIn, JSearch, Adzuna). Greenhouse, Lever, Ashby, etc. still make real calls even with mock mode on — but those are free anyway.
