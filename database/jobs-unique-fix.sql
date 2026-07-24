-- HireOrbit AI — fix the (source, external_id) dedupe index.
-- The original index used a WHERE clause (partial unique index). PostgREST's
-- onConflict=source,external_id doesn't pass that WHERE through, so Postgres
-- can't match it and upserts fail with:
--   "there is no unique or exclusion constraint matching the ON CONFLICT specification"
--
-- The fix: drop the partial variant and create a plain unique index. NULLs
-- in Postgres unique indexes are distinct by default, so locally-created
-- jobs (source=NULL, external_id=NULL) still don't conflict with each other.
--
-- Idempotent: safe to re-run.

drop index if exists public.jobs_source_external_uniq;

create unique index if not exists jobs_source_external_uniq
  on public.jobs (source, external_id);

-- Also deactivate slugs we know to be dead (companies that removed their
-- public job feeds). They were causing 404 noise in the sync report.
update public.source_companies
   set is_active = false
 where (source = 'lever'      and slug in ('brex', 'mixpanel', 'netflix'))
    or (source = 'greenhouse' and slug in ('doordash'));
