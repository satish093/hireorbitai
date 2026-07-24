-- HireOrbit AI — seed SearchApi.io Google Jobs ingestion queries.
--
-- SearchApi.io (https://www.searchapi.io/) hits the Google for Jobs SERP — same
-- aggregation as Jobright/Indeed/Dice/Monster/LinkedIn — at a cheaper rate than
-- SerpAPI. Requires SEARCHAPI_API_KEY in backend/.env. Each row below is a
-- separate paginated pull on every sync.
--
-- Idempotent: safe to re-run.

insert into public.source_companies (source, slug, display_name) values
  ('searchapi', 'software engineer in united states',       'SearchApi · SWE (US)'),
  ('searchapi', 'java developer in united states',          'SearchApi · Java (US)'),
  ('searchapi', 'data engineer in united states',           'SearchApi · Data (US)'),
  ('searchapi', 'full stack developer remote',              'SearchApi · Full Stack (Remote)'),
  ('searchapi', 'salesforce developer in united states',    'SearchApi · Salesforce (US)')
on conflict (source, slug) do nothing;

notify pgrst, 'reload schema';
