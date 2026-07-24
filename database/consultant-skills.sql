-- HireOrbit AI — multi-skill array on consultants.
-- `primary_skill` was a single text field, too coarse for the recommender.
-- This array lets consultants pick the 6-12 skills they want jobs matched
-- against (Jobright-style "Add skill" chip picker).
-- Idempotent: safe to re-run.

alter table public.consultants
  add column if not exists skills text[];

create index if not exists consultants_skills_gin
  on public.consultants using gin (skills);
