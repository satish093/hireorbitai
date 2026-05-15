-- HireOrbit AI — unified source_companies seed.
--
-- Idempotent: re-run any time to bring every driver online at once. Each
-- block is the same content as its individual file (kept separate so you
-- can also seed just one source if you want).
--
-- Driver requirements per source:
--   greenhouse / lever / ashby / remoteok / remotive / arbeitnow → free, public
--   adzuna       → needs ADZUNA_APP_ID + ADZUNA_APP_KEY
--   jsearch      → needs JSEARCH_API_KEY (RapidAPI)
--   jooble       → needs JOOBLE_API_KEY
--   usajobs      → needs USAJOBS_API_KEY + USAJOBS_USER_AGENT
--   serpapi      → needs SERPAPI_API_KEY
--   searchapi    → needs SEARCHAPI_API_KEY
--   linkedin     → needs RAPIDAPI_KEY (falls back to JSEARCH_API_KEY)
--   monster      → needs RAPIDAPI_KEY (falls back to JSEARCH_API_KEY)
--
-- Sources whose API key isn't configured stay in source_companies but will
-- error on sync (visible via GET /api/jobs/sources/health). That's intentional
-- so you can flip them on at any time without re-running this migration.

-- ---------------------------------------------------------------------------
-- Greenhouse + Lever (public per-company boards)
-- ---------------------------------------------------------------------------
insert into public.source_companies (source, slug, display_name) values
  ('greenhouse', 'anthropic', 'Anthropic'),
  ('greenhouse', 'stripe',    'Stripe'),
  ('greenhouse', 'airbnb',    'Airbnb'),
  ('greenhouse', 'figma',     'Figma'),
  ('greenhouse', 'discord',   'Discord'),
  ('greenhouse', 'gitlab',    'GitLab'),
  ('lever',      'plaid',     'Plaid')
on conflict (source, slug) do nothing;

-- ---------------------------------------------------------------------------
-- Ashby (per-company)
-- ---------------------------------------------------------------------------
insert into public.source_companies (source, slug, display_name) values
  ('ashby', 'ramp',     'Ramp · Ashby'),
  ('ashby', 'mercury',  'Mercury · Ashby'),
  ('ashby', 'linear',   'Linear · Ashby'),
  ('ashby', 'vercel',   'Vercel · Ashby')
on conflict (source, slug) do nothing;

-- ---------------------------------------------------------------------------
-- RemoteOK + Remotive + Arbeitnow (no slug)
-- ---------------------------------------------------------------------------
insert into public.source_companies (source, slug, display_name) values
  ('remoteok',  null, 'RemoteOK'),
  ('remotive',  null, 'Remotive'),
  ('arbeitnow', null, 'Arbeitnow')
on conflict (source, slug) do nothing;

-- ---------------------------------------------------------------------------
-- JSearch (RapidAPI; aggregates Indeed / LinkedIn / Dice / Monster / etc.)
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- LinkedIn (Fantastic Jobs on RapidAPI) — title filter as slug
-- ---------------------------------------------------------------------------
insert into public.source_companies (source, slug, display_name) values
  ('linkedin', 'Software Engineer',         'LinkedIn · SWE'),
  ('linkedin', 'Senior Software Engineer',  'LinkedIn · Senior SWE'),
  ('linkedin', 'Data Engineer',             'LinkedIn · Data Eng'),
  ('linkedin', 'Full Stack Developer',      'LinkedIn · Full Stack'),
  ('linkedin', 'Java Developer',            'LinkedIn · Java'),
  ('linkedin', 'DevOps Engineer',           'LinkedIn · DevOps'),
  ('linkedin', 'Salesforce Developer',      'LinkedIn · Salesforce'),
  ('linkedin', 'Machine Learning Engineer', 'LinkedIn · ML Eng')
on conflict (source, slug) do nothing;

-- ---------------------------------------------------------------------------
-- Monster (RapidAPI) — slug format is "keyword|location|countryCode"
-- ---------------------------------------------------------------------------
insert into public.source_companies (source, slug, display_name) values
  ('monster', 'software engineer|United States|en_us', 'Monster · SWE (US)'),
  ('monster', 'data engineer|United States|en_us',    'Monster · Data Eng (US)'),
  ('monster', 'full stack developer|United States|en_us', 'Monster · Full Stack (US)'),
  ('monster', 'java developer|United States|en_us',   'Monster · Java (US)'),
  ('monster', 'devops engineer|United States|en_us',  'Monster · DevOps (US)')
on conflict (source, slug) do nothing;

-- ---------------------------------------------------------------------------
-- Adzuna (needs ADZUNA_APP_ID + ADZUNA_APP_KEY)
-- ---------------------------------------------------------------------------
insert into public.source_companies (source, slug, display_name) values
  ('adzuna', null, 'Adzuna · US tech')
on conflict (source, slug) do nothing;

-- ---------------------------------------------------------------------------
-- USAJobs (federal, needs USAJOBS_API_KEY + USAJOBS_USER_AGENT)
-- ---------------------------------------------------------------------------
insert into public.source_companies (source, slug, display_name) values
  ('usajobs', 'software engineer', 'USAJobs · SWE'),
  ('usajobs', 'data scientist',    'USAJobs · Data Sci')
on conflict (source, slug) do nothing;

-- ---------------------------------------------------------------------------
-- SerpAPI Google Jobs (needs SERPAPI_API_KEY)
-- ---------------------------------------------------------------------------
insert into public.source_companies (source, slug, display_name) values
  ('serpapi', 'software engineer in united states', 'SerpAPI · SWE (US)')
on conflict (source, slug) do nothing;

-- ---------------------------------------------------------------------------
-- SearchApi.io Google Jobs (needs SEARCHAPI_API_KEY)
-- ---------------------------------------------------------------------------
insert into public.source_companies (source, slug, display_name) values
  ('searchapi', 'software engineer in united states', 'SearchApi · SWE (US)'),
  ('searchapi', 'java developer in united states',    'SearchApi · Java (US)'),
  ('searchapi', 'data engineer in united states',     'SearchApi · Data (US)')
on conflict (source, slug) do nothing;

-- ---------------------------------------------------------------------------
-- Jooble (needs JOOBLE_API_KEY)
-- ---------------------------------------------------------------------------
insert into public.source_companies (source, slug, display_name) values
  ('jooble', 'software engineer', 'Jooble · SWE'),
  ('jooble', 'data engineer',     'Jooble · Data Eng')
on conflict (source, slug) do nothing;

notify pgrst, 'reload schema';
