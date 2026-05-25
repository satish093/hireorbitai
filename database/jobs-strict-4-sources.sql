-- jobs-strict-4-sources.sql
-- Restrict job ingestion to LinkedIn, Dice, Monster, and CareerBuilder ONLY.
-- Idempotent — safe to re-run.
--
-- LinkedIn  → Fantastic Jobs API (RapidAPI, source = 'linkedin')
-- Dice      → JSearch with site:dice.com (source = 'jsearch')
-- CareerBuilder → JSearch with site:careerbuilder.com (source = 'jsearch')
-- Monster   → Monster Jobs API (RapidAPI, source = 'monster') — dedicated driver
--
-- After applying: set env vars MONSTER_KEYWORDS, MONSTER_LOCATION, MONSTER_COUNTRY_CODE
-- and choose JOB_SYNC_INTERVAL_MS based on your API tier:
--   $110/mo Power   → 21600000  (6h)
--   $30/mo  Standard → 43200000 (12h)  ← recommended
--   $20/mo  Budget   → 86400000 (24h)

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Remove all source rows that are NOT linkedin, jsearch, or monster.
--    This wipes Greenhouse, Lever, Ashby, Adzuna, Remotive, RemoteOK, etc.
-- ────────────────────────────────────────────────────────────────────────────
DELETE FROM source_companies
WHERE source NOT IN ('linkedin', 'jsearch', 'monster');

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Remove any JSearch rows that were targeting Monster via site: operator.
--    Monster now has its own dedicated driver; duplicate ingestion would cause
--    dedup mismatches (different external_id formats between the two drivers).
-- ────────────────────────────────────────────────────────────────────────────
DELETE FROM source_companies
WHERE source = 'jsearch'
  AND (slug ILIKE '%monster%' OR slug ILIKE '%site:monster%');

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Activate (or insert) Monster driver rows.
--    The fetchMonster driver already exists in jobIngestion.service.ts —
--    it just needed active source_companies rows to run.
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO source_companies (name, source, slug, is_active)
VALUES
  ('Monster — Software Engineer', 'monster', 'software engineer', true),
  ('Monster — Data Engineer',     'monster', 'data engineer',     true),
  ('Monster — Java Developer',    'monster', 'java developer',    true)
ON CONFLICT (source, slug) DO UPDATE
  SET is_active            = true,
      consecutive_failures = 0,
      auto_deactivated_at  = NULL,
      auto_deactivated_reason = NULL;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Ensure the Dice and CareerBuilder JSearch rows are active.
--    If they were auto-deactivated due to past failures, reset them.
-- ────────────────────────────────────────────────────────────────────────────
UPDATE source_companies
SET    is_active            = true,
       consecutive_failures = 0,
       auto_deactivated_at  = NULL,
       auto_deactivated_reason = NULL
WHERE  source = 'jsearch'
  AND  (slug ILIKE '%dice%' OR slug ILIKE '%careerbuilder%');

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Insert JSearch rows for Dice + CareerBuilder if they don't exist yet.
--    The slugs are the query strings passed to the JSearch API.
--    The publisher filter added in jobIngestion.service.ts ensures only
--    Dice/CareerBuilder results are saved even if JSearch returns others.
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO source_companies (name, source, slug, is_active)
VALUES
  ('JSearch · Dice · Software Engineer',    'jsearch', 'software engineer site:dice.com',        true),
  ('JSearch · Dice · Data Engineer',        'jsearch', 'data engineer site:dice.com',             true),
  ('JSearch · Dice · Java Developer',       'jsearch', 'java developer site:dice.com',            true),
  ('JSearch · CareerBuilder · SWE',         'jsearch', 'software engineer site:careerbuilder.com',true),
  ('JSearch · CareerBuilder · Data Eng',    'jsearch', 'data engineer site:careerbuilder.com',    true)
ON CONFLICT (source, slug) DO UPDATE
  SET is_active            = true,
      consecutive_failures = 0,
      auto_deactivated_at  = NULL,
      auto_deactivated_reason = NULL;

-- ────────────────────────────────────────────────────────────────────────────
-- 6. (Optional) Remove existing jobs from other publishers.
--    Uncomment after confirming the above changes are working.
-- ────────────────────────────────────────────────────────────────────────────
-- DELETE FROM jobs
-- WHERE publisher NOT IN ('LinkedIn', 'Dice', 'Monster', 'CareerBuilder')
--   AND publisher IS NOT NULL;

-- ────────────────────────────────────────────────────────────────────────────
-- Verification queries (run manually to confirm):
--
--   SELECT source, name, is_active, slug
--   FROM source_companies
--   ORDER BY source, name;
--   -- Expected: only linkedin, jsearch, monster rows
--
--   SELECT source, COUNT(*) FROM source_companies GROUP BY source;
-- ────────────────────────────────────────────────────────────────────────────
