-- HireOrbit AI — broaden JSearch ingestion so the recommended feed shows
-- listings from Dice / LinkedIn / Monster / CareerBuilder / Indeed / Glassdoor
-- / ZipRecruiter. These boards do not expose free direct APIs, but JSearch
-- (RapidAPI) is a legal aggregator over all of them. Each row below is a
-- separate paginated pull on every sync; using broad, role-based queries
-- yields a wider spread of publishers than a single generic query.
--
-- Idempotent: safe to re-run.

insert into public.source_companies (source, slug, display_name) values
  ('jsearch', 'software engineer jobs in united states',     'JSearch · SWE (US)'),
  ('jsearch', 'senior software engineer jobs',               'JSearch · Senior SWE'),
  ('jsearch', 'data engineer jobs in united states',         'JSearch · Data Eng (US)'),
  ('jsearch', 'data scientist jobs in united states',        'JSearch · Data Sci (US)'),
  ('jsearch', 'full stack developer jobs',                   'JSearch · Full Stack'),
  ('jsearch', 'devops engineer jobs',                        'JSearch · DevOps'),
  ('jsearch', 'cloud engineer jobs',                         'JSearch · Cloud'),
  ('jsearch', 'machine learning engineer jobs',              'JSearch · ML Eng'),
  ('jsearch', 'react developer jobs',                        'JSearch · React'),
  ('jsearch', 'java developer jobs',                         'JSearch · Java'),
  ('jsearch', 'python developer jobs',                       'JSearch · Python'),
  ('jsearch', 'salesforce developer jobs',                   'JSearch · Salesforce'),
  ('jsearch', 'qa automation engineer jobs',                 'JSearch · QA'),
  ('jsearch', 'business analyst jobs',                       'JSearch · BA'),
  ('jsearch', 'project manager jobs',                        'JSearch · PM')
on conflict (source, slug) do nothing;
