-- ---------------------------------------------------------------------------
-- Revert the free no-API scraper experiment → back to Plan B (~$10/month)
--
-- Turns OFF the 'scraper' rows (and the free guest path) and re-activates the
-- ~$10 Plan B set: paid LinkedIn (RapidAPI Basic) + free JSearch site: queries
-- for Dice / Monster / CareerBuilder + free Adzuna. Pairs with reverting the
-- scraper code and setting LINKEDIN_FREE=false (paid LinkedIn driver) in
-- backend/.env.
--
-- Env reminder (backend/.env):
--   LINKEDIN_FREE=false            # (or remove the line) → use paid RapidAPI LinkedIn
--   RAPIDAPI_KEY=<key>             # LinkedIn-Job-Search-API Basic (~$10/mo)
--   JSEARCH_API_KEY=<key>          # JSearch free tier (150/mo)
--   JOB_SYNC_INTERVAL_MS=86400000  # 24h
--   LINKEDIN_TITLES=Software Engineer|Data Engineer|Full Stack Developer
-- Then: pm2 restart hireorbitai-api
--
-- Idempotent. Pure data fix, no DDL.
-- ---------------------------------------------------------------------------

-- --- 1. Turn OFF the scraper rows -----------------------------------------
UPDATE public.source_companies
SET is_active = false,
    auto_deactivated_at = now(),
    auto_deactivated_reason = 'Reverted free scraper — back to Plan B ($10)'
WHERE source = 'scraper';

-- --- 2. Re-activate the 3 budgeted LinkedIn title rows (paid RapidAPI) -----
UPDATE public.source_companies SET
  is_active = true,
  consecutive_failures = 0,
  last_sync_error = NULL,
  auto_deactivated_at = NULL,
  auto_deactivated_reason = NULL
WHERE source = 'linkedin'
  AND slug IN ('Software Engineer', 'Data Engineer', 'Full Stack Developer');

-- --- 3. Adzuna (free tier) -------------------------------------------------
UPDATE public.source_companies SET
  is_active = true,
  consecutive_failures = 0,
  last_sync_error = NULL,
  auto_deactivated_at = NULL,
  auto_deactivated_reason = NULL
WHERE source = 'adzuna';

-- --- 4. JSearch site: rows for Dice / Monster / CareerBuilder (free) -------
INSERT INTO public.source_companies (source, slug, display_name, is_active)
VALUES
  ('jsearch', 'software engineer site:dice.com',           'JSearch · Dice · SWE',           true),
  ('jsearch', 'data engineer site:monster.com',            'JSearch · Monster · Data Eng',   true),
  ('jsearch', 'software engineer site:careerbuilder.com',  'JSearch · CareerBuilder · SWE',  true),
  ('jsearch', 'java developer site:dice.com|java developer site:monster.com',
                                                           'JSearch · Dice+Monster · Java',  true)
ON CONFLICT (source, slug) DO UPDATE SET
  is_active = true,
  display_name = EXCLUDED.display_name,
  consecutive_failures = 0,
  last_sync_error = NULL,
  auto_deactivated_at = NULL,
  auto_deactivated_reason = NULL;

NOTIFY pgrst, 'reload schema';
