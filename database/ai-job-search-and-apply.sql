-- HireOrbit AI — AI Job Search and Apply module (Jobright-style).
--
-- Adds the schema needed for:
--   1) AI-tailored resume versions (parent ↔ tailored linkage + metadata)
--   2) Application records with method + match score (CUSTOMIZED / ORIGINAL)
--   3) Application history view used by the recruiter "applied" tab
--   4) Ashby ingestion source registered in source_companies
--
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- RESUMES — tailored version metadata
-- ---------------------------------------------------------------------------
alter table public.resumes
  add column if not exists tailored_for_job_id uuid references public.jobs(id) on delete set null;
alter table public.resumes
  add column if not exists parent_resume_id    uuid references public.resumes(id) on delete set null;
alter table public.resumes
  add column if not exists tailor_metadata     jsonb;
-- Raw markdown / plain-text body of the tailored resume (we store text rather
-- than render a fresh PDF on the server side — the recruiter can download the
-- .md and convert through any preferred tool).
alter table public.resumes
  add column if not exists body_text           text;

create index if not exists resumes_tailored_for_idx
  on public.resumes (tailored_for_job_id);
create index if not exists resumes_parent_idx
  on public.resumes (parent_resume_id);

-- ---------------------------------------------------------------------------
-- APPLICATIONS — method + scores
-- ---------------------------------------------------------------------------
do $$ begin
  create type application_method as enum ('CUSTOMIZED', 'ORIGINAL');
exception when duplicate_object then null; end $$;

alter table public.applications
  add column if not exists applied_method application_method;
alter table public.applications
  add column if not exists match_score    numeric(5,2);
alter table public.applications
  add column if not exists source_url     text;
alter table public.applications
  add column if not exists tailored_resume_id uuid references public.resumes(id) on delete set null;

create index if not exists applications_method_idx
  on public.applications (applied_method);

-- ---------------------------------------------------------------------------
-- ASHBY — register the driver. Public-board API shape matches Greenhouse.
--   Endpoint: https://api.ashbyhq.com/posting-api/job-board/{org-slug}
-- ---------------------------------------------------------------------------
insert into public.source_companies (source, slug, display_name) values
  ('ashby', 'ramp',     'Ramp · Ashby'),
  ('ashby', 'mercury',  'Mercury · Ashby'),
  ('ashby', 'linear',   'Linear · Ashby'),
  ('ashby', 'vercel',   'Vercel · Ashby')
on conflict (source, slug) do nothing;

notify pgrst, 'reload schema';
