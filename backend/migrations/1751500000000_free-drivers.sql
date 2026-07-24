-- Migrate to four-source free stack:
--   Dice        → direct REST API (no key)
--   CareerBuilder → HTTP + Next.js SSR (no key)
--   Monster     → Playwright headless (no key)
--   LinkedIn    → RapidAPI Fantastic Jobs (RAPIDAPI_KEY)
--
-- Removes all legacy drivers (jsearch, remoteok, greenhouse, lever, ashby,
-- remotive, arbeitnow, adzuna, jooble, usajobs, serpapi, searchapi) and
-- seeds clean source_companies rows for the four active boards.

-- 1. Remove every source that no longer has a driver --------------------
DELETE FROM public.source_companies
WHERE source NOT IN ('linkedin', 'monster', 'dice', 'careerbuilder', 'manual');

-- 2. Seed Dice source rows (native direct-API driver) -------------------
INSERT INTO public.source_companies (source, slug, display_name, is_active)
VALUES
  ('dice', 'software engineer', 'Dice — Software Engineer', true),
  ('dice', 'data engineer',     'Dice — Data Engineer',     true),
  ('dice', 'java developer',    'Dice — Java Developer',    true)
ON CONFLICT (source, slug) DO UPDATE
  SET is_active              = true,
      consecutive_failures   = 0,
      auto_deactivated_at    = NULL,
      auto_deactivated_reason = NULL;

-- 3. Seed CareerBuilder source rows (native HTTP driver) ----------------
INSERT INTO public.source_companies (source, slug, display_name, is_active)
VALUES
  ('careerbuilder', 'software engineer', 'CareerBuilder — Software Engineer', true),
  ('careerbuilder', 'data engineer',     'CareerBuilder — Data Engineer',     true),
  ('careerbuilder', 'java developer',    'CareerBuilder — Java Developer',    true)
ON CONFLICT (source, slug) DO UPDATE
  SET is_active              = true,
      consecutive_failures   = 0,
      auto_deactivated_at    = NULL,
      auto_deactivated_reason = NULL;

-- 4. Ensure Monster rows are active and failure counters are reset -------
--    (rows already exist from jobs-strict-4-sources.sql)
UPDATE public.source_companies
SET is_active              = true,
    consecutive_failures   = 0,
    auto_deactivated_at    = NULL,
    auto_deactivated_reason = NULL
WHERE source = 'monster';

-- 5. Ensure LinkedIn rows are active and failure counters are reset ------
UPDATE public.source_companies
SET is_active              = true,
    consecutive_failures   = 0,
    auto_deactivated_at    = NULL,
    auto_deactivated_reason = NULL
WHERE source = 'linkedin';

NOTIFY pgrst, 'reload schema';
