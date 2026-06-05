-- Per-user dismissed ("Not interested") jobs. Mirrors liked_jobs.
--
-- A dismissed job drops out of that user's /jobs/recommended feed (Jobright-
-- style "swipe away"). Composite PK makes dismiss idempotent (upsert). The
-- recommended-feed filter is fail-open: if this table isn't migrated yet the
-- feed still renders every job.
--
-- Idempotent: safe to re-run.

create table if not exists public.dismissed_jobs (
  user_id      uuid not null references public.users (id) on delete cascade,
  job_id       uuid not null references public.jobs (id) on delete cascade,
  dismissed_at timestamptz not null default now(),
  primary key (user_id, job_id)
);

create index if not exists dismissed_jobs_user_idx on public.dismissed_jobs (user_id);

notify pgrst, 'reload schema';
