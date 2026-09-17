-- LinkedIn-specific job identity, kept alongside the existing generic
-- source/external_id/apply_url columns (see database/job-ingestion.sql).
-- `application_type` distinguishes a LinkedIn-native Easy Apply flow from one
-- that redirects to the employer's own ATS — the Application Copilot uses it
-- to decide whether to show the guided wizard or a plain "this uses an
-- external site" notice. It stays null until the copilot (or a future
-- ingestion pass) actually classifies a job; existing rows are not backfilled
-- for it, since nothing today observes a job's real apply page.
--
-- linkedin_job_id/linkedin_job_url ARE backfilled, but only where apply_url
-- already matches a real linkedin.com/jobs/... URL (regardless of `source` —
-- 'linkedin' rows from the RapidAPI driver and 'linkedin_hacp' rows from the
-- HACP webhook are both matched by content, not trusted by label, since the
-- HACP path's apply_url can be a synthesized Google-search fallback when the
-- real one is missing — see safeApplyUrl() in hacpWebhook.controller.ts).
--
-- Idempotent: safe to re-run.

alter table public.jobs add column if not exists linkedin_job_id text;
alter table public.jobs add column if not exists linkedin_job_url text;
alter table public.jobs add column if not exists application_type text
  check (application_type in ('linkedin_native', 'external_ats'));

update public.jobs
set linkedin_job_url = apply_url,
    linkedin_job_id = substring(apply_url from 'linkedin\.com/jobs/view/(\d+)')
where linkedin_job_url is null
  and apply_url ~* 'linkedin\.com/jobs/';

create index if not exists idx_jobs_linkedin_job_id
  on public.jobs (linkedin_job_id) where linkedin_job_id is not null;

notify pgrst, 'reload schema';
