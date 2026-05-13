-- TalentBridge AI — Apply-flow tables (Jobright-style).
--
-- Adds three coupled tables to complete the Apply pipeline:
--
--   1) resume_job_matches      — cached per-(consultant, job, resume) score so
--                                the recommended feed doesn't recompute on every
--                                pageview.
--   2) resume_customizations   — first-class record of every AI-tailored variant
--                                (extends the metadata already in resumes.tailor_metadata
--                                so we can query "all customizations for job X").
--   3) application_events      — audit trail of the apply funnel:
--                                viewed, customize_started, customize_finished,
--                                apply_clicked, apply_confirmed, apply_declined,
--                                status_changed, …
--
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- 1) resume_job_matches
-- ---------------------------------------------------------------------------
create table if not exists public.resume_job_matches (
  id uuid primary key default gen_random_uuid(),
  consultant_id uuid not null references public.consultants(id) on delete cascade,
  job_id        uuid not null references public.jobs(id)        on delete cascade,
  resume_id     uuid references public.resumes(id) on delete set null,
  match_score   numeric(5,2),
  ats_score     numeric(5,2),
  rank_desc     text,
  missing_keywords text[],
  rationale     text[],
  computed_at   timestamptz not null default now(),
  -- One row per (consultant, job, resume) triple — re-runs upsert.
  unique (consultant_id, job_id, resume_id)
);
create index if not exists rjm_consultant_idx on public.resume_job_matches (consultant_id);
create index if not exists rjm_job_idx        on public.resume_job_matches (job_id);

-- ---------------------------------------------------------------------------
-- 2) resume_customizations
-- ---------------------------------------------------------------------------
create table if not exists public.resume_customizations (
  id uuid primary key default gen_random_uuid(),
  consultant_id     uuid not null references public.consultants(id) on delete cascade,
  job_id            uuid not null references public.jobs(id)        on delete cascade,
  source_resume_id  uuid references public.resumes(id) on delete set null,
  tailored_resume_id uuid references public.resumes(id) on delete set null,
  sections_chosen   text[] not null default '{}',
  keywords_chosen   text[] not null default '{}',
  keywords_added    text[] not null default '{}',
  changes_summary   text[] not null default '{}',
  before_score      numeric(5,2),
  after_score       numeric(5,2),
  created_by        uuid references public.users(id) on delete set null,
  created_at        timestamptz not null default now()
);
create index if not exists rc_consultant_idx on public.resume_customizations (consultant_id);
create index if not exists rc_job_idx        on public.resume_customizations (job_id);

-- ---------------------------------------------------------------------------
-- 3) application_events
-- ---------------------------------------------------------------------------
do $$ begin
  create type application_event_kind as enum (
    'viewed',
    'apply_clicked',
    'customize_started',
    'customize_finished',
    'apply_confirmed',
    'apply_declined',
    'status_changed',
    'note'
  );
exception when duplicate_object then null; end $$;

create table if not exists public.application_events (
  id uuid primary key default gen_random_uuid(),
  -- application_id is OPTIONAL because we log events BEFORE an application
  -- exists (e.g. viewed, apply_clicked, apply_declined).
  application_id uuid references public.applications(id) on delete cascade,
  job_id         uuid references public.jobs(id) on delete set null,
  consultant_id  uuid references public.consultants(id) on delete set null,
  kind           application_event_kind not null,
  payload        jsonb,
  created_by     uuid references public.users(id) on delete set null,
  created_at     timestamptz not null default now()
);
create index if not exists app_events_application_idx on public.application_events (application_id, created_at desc);
create index if not exists app_events_job_idx         on public.application_events (job_id, created_at desc);
create index if not exists app_events_consultant_idx  on public.application_events (consultant_id, created_at desc);
create index if not exists app_events_kind_idx        on public.application_events (kind);

alter table public.resume_job_matches    enable row level security;
alter table public.resume_customizations enable row level security;
alter table public.application_events    enable row level security;

notify pgrst, 'reload schema';
