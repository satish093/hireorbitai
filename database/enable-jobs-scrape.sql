-- ---------------------------------------------------------------------------
-- Job ingestion — FREE, no-API scraping ($0/month)
--
-- LinkedIn via its unauthenticated guest job-search endpoint, and
-- Dice / Monster / CareerBuilder via JobPosting JSON-LD on their public pages.
-- HTTP-only, sequential, low-RAM — no paid API, no browser, no auth/CAPTCHA
-- bypass. See backend/src/services/jobIngestion.service.ts (fetchLinkedInGuest
-- + scrapeJsonLd).
--
-- ⚠ Best-effort & low-volume: from a datacenter/VPS IP, LinkedIn may return
--   429 after a few requests and Dice/Monster/CareerBuilder's bot protection
--   (Cloudflare/PerimeterX) may block or challenge. Polite delays + a real
--   User-Agent reduce, but don't eliminate, this. Reliable volume needs a
--   residential proxy (paid) — not included.
-- ---------------------------------------------------------------------------
-- Operator env-var checklist (set in backend/.env BEFORE applying):
--
--   LINKEDIN_FREE=true                 # use the free guest endpoint, not RapidAPI
--   LINKEDIN_TITLES=Software Engineer  # pipe-delimited search keywords (also the linkedin row slug)
--   LINKEDIN_LOCATIONS=United States
--   LINKEDIN_WINDOW=24h                # 1h | 24h | 7d
--   LINKEDIN_MAX_JOBS=75
--
--   SCRAPER_DELAY_MS=2500              # polite delay between requests
--   SCRAPER_TIMEOUT_MS=15000
--   SCRAPER_MAX_JOBS=60
--   SCRAPER_USER_AGENT=<a real desktop browser UA>   # optional; sensible default built in
--
--   JOB_SYNC_INTERVAL_MS=86400000      # 24h — keep volume/blocking low
--
-- No RAPIDAPI_KEY / JSEARCH_API_KEY needed for these rows.
-- ---------------------------------------------------------------------------
-- Idempotent: safe to re-apply. Pure data fix, no DDL.
-- ---------------------------------------------------------------------------

-- --- 1. LinkedIn — free guest endpoint -----------------------------------
-- With LINKEDIN_FREE=true the existing 'linkedin' driver scrapes the guest
-- endpoint instead of RapidAPI. The slug is the search keyword.
INSERT INTO public.source_companies (source, slug, display_name, is_active)
VALUES ('linkedin', 'Software Engineer', 'LinkedIn (free guest) · SWE', true)
ON CONFLICT (source, slug) DO UPDATE SET
  is_active = true,
  display_name = EXCLUDED.display_name,
  consecutive_failures = 0,
  last_sync_error = NULL,
  auto_deactivated_at = NULL,
  auto_deactivated_reason = NULL;

-- --- 2. Dice / Monster / CareerBuilder — JSON-LD scraper -------------------
-- Slug = a public page URL whose HTML carries JobPosting JSON-LD. Pipe-delimit
-- to scrape several pages in one row. Edit the keywords to your roles.
INSERT INTO public.source_companies (source, slug, display_name, is_active)
VALUES
  ('scraper', 'https://www.dice.com/jobs?q=software%20engineer&location=United%20States',
              'Scraper · Dice · SWE', true),
  ('scraper', 'https://www.monster.com/jobs/search?q=Software-Engineer&where=United-States',
              'Scraper · Monster · SWE', true),
  ('scraper', 'https://www.careerbuilder.com/jobs?keywords=software+engineer',
              'Scraper · CareerBuilder · SWE', true)
ON CONFLICT (source, slug) DO UPDATE SET
  is_active = true,
  display_name = EXCLUDED.display_name,
  consecutive_failures = 0,
  last_sync_error = NULL,
  auto_deactivated_at = NULL,
  auto_deactivated_reason = NULL;

-- --- 3. Keep the paid Monster RapidAPI driver OFF -------------------------
UPDATE public.source_companies
SET is_active = false,
    auto_deactivated_at = now(),
    auto_deactivated_reason = 'Free scrape plan — Monster covered via JSON-LD scraper'
WHERE source = 'monster'
  AND is_active = true;

NOTIFY pgrst, 'reload schema';
