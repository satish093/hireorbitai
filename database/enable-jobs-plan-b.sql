-- ---------------------------------------------------------------------------
-- Job ingestion — Plan B ($10/month budget)
--
-- Activates a narrow, budget-conscious set of job sources:
--   • 3 LinkedIn title queries via the dedicated RapidAPI scraper
--     (Fantastic Jobs' linkedin-job-search-api).
--   • 4 JSearch queries with `site:` operators that surface Dice,
--     Monster, and CareerBuilder via JSearch's Google-for-Jobs
--     aggregator. The driver auto-fills the `publisher` column from
--     job_publisher metadata.
--   • 1 Adzuna row (env-driven query) on the forever-free 1000/mo tier.
--
-- Keeps the dedicated `monster` RapidAPI driver DISABLED — Plan B covers
-- Monster jobs through JSearch's publisher filter, not a second paid
-- endpoint.
--
-- ---------------------------------------------------------------------------
-- Operator env-var checklist (set in backend/.env BEFORE applying):
--
--   RAPIDAPI_KEY=<your RapidAPI key>
--     Subscribe to "LinkedIn-Job-Search-API by Fantastic Jobs" on the
--     RapidAPI marketplace at Basic tier (~$10/mo, ~1000 req/mo).
--     Leave JSearch on the FREE tier (~150 req/mo).
--     If JSEARCH_API_KEY is unset, the LinkedIn driver falls back to
--     RAPIDAPI_KEY — they can be the same RapidAPI account.
--
--   ADZUNA_APP_ID=<id>
--   ADZUNA_APP_KEY=<key>
--     Free signup at https://developer.adzuna.com — instant key,
--     1000 calls/month forever-free.
--
--   JOB_SYNC_INTERVAL_MS=86400000
--     Sync once per 24h. Required to stay under JSearch's 150/mo free
--     quota. The default 21600000 (6h) would burn the quota in ~9 days.
--
--   LINKEDIN_TITLES=Software Engineer|Data Engineer|Full Stack Developer
--   LINKEDIN_WINDOW=24h
--     Match the 3 source-rows activated below. The env.example default
--     lists all 8 titles; this plan only enables 3.
--
--   ADZUNA_WHAT=software engineer
--   ADZUNA_COUNTRY=us
--     Optional. Defaults are fine for a tech recruiting pipeline.
--
-- ---------------------------------------------------------------------------
-- Budget math:
--
--   LinkedIn:  3 titles × 30 syncs/mo (24h)      =  90 req → fits ~$10 Basic (1000)
--   JSearch:   4 queries × 30 syncs/mo (24h)     = 120 req → fits Free (150)
--   Adzuna:    1 row × 30 syncs/mo (24h)         =  30 req → fits Free (1000)
--   Monster:   DISABLED                          =   0 req
--   ---------------------------------------------------------------
--   Total:                                       ~$10/month
--
-- ---------------------------------------------------------------------------
-- Idempotent: safe to re-apply. Pure data fix, no DDL.
-- ---------------------------------------------------------------------------

-- --- 1. Re-activate the 3 budgeted LinkedIn title rows --------------------
-- Matches against the auto-deactivation reason so we don't accidentally
-- revive a row that was deactivated later for a real failure.
UPDATE public.source_companies SET
  is_active = true,
  consecutive_failures = 0,
  last_sync_error = NULL,
  auto_deactivated_at = NULL,
  auto_deactivated_reason = NULL
WHERE source = 'linkedin'
  AND slug IN ('Software Engineer', 'Data Engineer', 'Full Stack Developer')
  AND (
    auto_deactivated_reason = 'Paid / quota-heavy driver — opt-in only'
    OR is_active = false
  );

-- The other 5 LinkedIn seed slugs (Senior Software Engineer, Java Developer,
-- DevOps Engineer, Salesforce Developer, Machine Learning Engineer) stay
-- DEACTIVATED on purpose. To expand to 8 titles you need RapidAPI LinkedIn
-- Pro tier (~$30/mo); revisit this migration then.

-- --- 2. Re-activate Adzuna (free tier) ------------------------------------
UPDATE public.source_companies SET
  is_active = true,
  consecutive_failures = 0,
  last_sync_error = NULL,
  auto_deactivated_at = NULL,
  auto_deactivated_reason = NULL
WHERE source = 'adzuna'
  AND (
    auto_deactivated_reason = 'Requires API key not set by default — opt-in by setting env var'
    OR is_active = false
  );

-- --- 3. Add JSearch publisher-filter rows ---------------------------------
-- These use Google's `site:` operator to constrain results to a single
-- publisher. The JSearch driver's normalizePublisher() helper maps the
-- raw job_publisher field to clean strings ('Dice', 'Monster',
-- 'CareerBuilder'), so the publisher column on public.jobs stays
-- accurate even if Google relaxes the site: filter.
--
-- One JSearch source-row = one slug, but the slug itself supports
-- pipe-delimited multi-query: every `|`-separated chunk fires one
-- JSearch API call. Keep the chunk count low — each chunk eats one
-- of the 150 monthly free-tier requests.
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

-- --- 4. Document why Monster stays disabled -------------------------------
-- The dedicated Monster RapidAPI driver remains deactivated per migration
-- backend/migrations/1700000000003_source_company_self_heal.sql:65-70.
-- Plan B covers Monster via JSearch's `publisher = 'Monster'` rows above.
-- If you ever re-enable Monster directly, drop the JSearch site:monster.com
-- row first or you'll double-bill RapidAPI quota on overlapping data.

NOTIFY pgrst, 'reload schema';
