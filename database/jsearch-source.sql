-- HireOrbit AI — seed a JSearch (RapidAPI) ingestion source.
-- JSearch indexes Indeed / LinkedIn / Glassdoor / ZipRecruiter / Monster
-- listings legitimately. Requires JSEARCH_API_KEY in backend/.env.
-- Idempotent: safe to re-run.
--
-- The slug here is the search query. Use multiple rows for multiple queries
-- (each gets its own pull on every sync), or leave slug NULL to use the
-- JSEARCH_QUERIES env var (pipe-separated).

insert into public.source_companies (source, slug, display_name) values
  ('jsearch', 'software engineer in united states', 'JSearch · SWE (US)'),
  ('jsearch', 'data engineer in united states',     'JSearch · Data Eng (US)'),
  ('jsearch', 'full stack developer remote',         'JSearch · Full Stack (Remote)')
on conflict (source, slug) do nothing;
