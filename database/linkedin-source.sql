-- TalentBridge AI — seed LinkedIn ingestion via the Fantastic Jobs
-- "LinkedIn Job Search API" on RapidAPI. Reuses RAPIDAPI_KEY (falls back to
-- JSEARCH_API_KEY) since they're typically the same RapidAPI account.
--
-- Each row's slug is a job-title filter (the API's `title_filter` param).
-- The endpoint window (`active-jb-24h` by default) is controlled via the
-- LINKEDIN_WINDOW env var.
--
-- Idempotent: safe to re-run.

insert into public.source_companies (source, slug, display_name) values
  ('linkedin', 'Software Engineer',       'LinkedIn · SWE'),
  ('linkedin', 'Senior Software Engineer','LinkedIn · Senior SWE'),
  ('linkedin', 'Data Engineer',           'LinkedIn · Data Eng'),
  ('linkedin', 'Full Stack Developer',    'LinkedIn · Full Stack'),
  ('linkedin', 'Java Developer',          'LinkedIn · Java'),
  ('linkedin', 'DevOps Engineer',         'LinkedIn · DevOps'),
  ('linkedin', 'Salesforce Developer',    'LinkedIn · Salesforce'),
  ('linkedin', 'Machine Learning Engineer','LinkedIn · ML Eng')
on conflict (source, slug) do nothing;

notify pgrst, 'reload schema';
