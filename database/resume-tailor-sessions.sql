-- resume-tailor-sessions.sql
-- ---------------------------------------------------------------------------
-- Backing tables for the deep resume "tailoring workspace".
--
-- A tailor SESSION captures one AI tailoring run from a base resume version
-- toward a target job, plus the plain-English summary and before/after ATS
-- scores. Each session owns an ordered list of per-section EDITS the recruiter
-- reviews (accept / reject / hand-edit) before materializing them into a brand
-- new resume version.
--
-- NOTE on the data model: in this codebase a resume "version" is not a separate
-- table — each row of public.resumes IS a version (keyed by
-- (consultant_id, version)). So base_version_id / result_version_id reference
-- public.resumes(id) directly, not a (non-existent) resume_versions table.
--
-- result_markdown holds the full AI-rewritten body so "apply" can reconstruct
-- the final version from the accepted/rejected/edited subset without a second
-- AI round-trip.
--
-- Idempotent: safe to re-run.
-- ---------------------------------------------------------------------------

create table if not exists public.resume_tailor_sessions (
  id                uuid primary key default gen_random_uuid(),
  resume_id         uuid not null references public.resumes(id) on delete cascade,
  base_version_id   uuid not null references public.resumes(id),
  result_version_id uuid references public.resumes(id),
  job_id            uuid references public.jobs(id),
  applied           boolean not null default false,
  ai_summary        text not null,
  result_markdown   text,
  score_before      int  not null,
  score_after       int,
  edit_count        int  not null default 0,
  created_by        uuid not null references public.users(id),
  created_at        timestamptz not null default now()
);
create index if not exists rts_resume_idx   on public.resume_tailor_sessions (resume_id);
create index if not exists rts_base_idx      on public.resume_tailor_sessions (base_version_id);
create index if not exists rts_job_idx       on public.resume_tailor_sessions (job_id);

create table if not exists public.resume_tailor_edits (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references public.resume_tailor_sessions(id) on delete cascade,
  section      text not null,
  before_text  text,
  after_text   text not null,
  ai_reason    text not null,
  status       text not null default 'proposed'
                 check (status in ('proposed', 'accepted', 'rejected', 'edited')),
  ordinal      int  not null
);
create index if not exists rte_session_idx on public.resume_tailor_edits (session_id);

notify pgrst, 'reload schema';
