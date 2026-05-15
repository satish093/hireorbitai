-- HireOrbit AI — seed Monster ingestion via the "Monster Jobs API" on
-- RapidAPI. Reuses RAPIDAPI_KEY (falls back to JSEARCH_API_KEY).
--
-- Slug format: "<keyword>|<location>|<countryCode>"  (location + country
-- optional; the driver falls back to MONSTER_LOCATION / MONSTER_COUNTRY_CODE
-- env vars when omitted).
--
-- Idempotent: safe to re-run.

insert into public.source_companies (source, slug, display_name) values
  ('monster', 'software engineer|United States|en_us', 'Monster · SWE (US)'),
  ('monster', 'data engineer|United States|en_us',    'Monster · Data Eng (US)'),
  ('monster', 'full stack developer|United States|en_us', 'Monster · Full Stack (US)'),
  ('monster', 'java developer|United States|en_us',   'Monster · Java (US)'),
  ('monster', 'devops engineer|United States|en_us',  'Monster · DevOps (US)')
on conflict (source, slug) do nothing;

notify pgrst, 'reload schema';
