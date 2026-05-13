-- TalentBridge AI — Jobs module extras (Jobright-style features)
-- Idempotent: safe to re-run.

-- liked_jobs: user-level bookmark of a job
create table if not exists public.liked_jobs (
  user_id uuid not null references public.users(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, job_id)
);
create index if not exists liked_jobs_user_idx on public.liked_jobs (user_id, created_at desc);

-- Extracted / cached requirement-extraction output from AI (years, must-haves,
-- visa requirements, etc.) so we don't re-call the model on every read.
alter table public.jobs add column if not exists requirements jsonb;

-- Optional: classify job level so we can filter Senior / Lead / Staff in the UI.
alter table public.jobs add column if not exists level text;
create index if not exists jobs_level_idx on public.jobs (level);

-- Optional: how long the listing has been open (for "Be an early applicant").
-- Already have posted_at; nothing else needed there.

alter table public.liked_jobs enable row level security;
