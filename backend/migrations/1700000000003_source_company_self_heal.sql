-- Bake the manual VPS/DB cleanups into a migration so any fresh environment
-- (and the existing prod DB once this runs) heals automatically.
--
-- Two halves:
--   1. Schema additions for driver self-healing — consecutive_failures counter
--      and an audit pair (auto_deactivated_at + auto_deactivated_reason) so
--      operators can see WHY a row went quiet without diving into logs.
--   2. One-time data fixes — deactivate the rows we know are broken or
--      paid/quota-burned, dedupe no-slug drivers down to one row each.
--
-- Idempotent. Re-running on a DB where these are already applied is a no-op
-- (column adds use IF NOT EXISTS, UPDATEs only flip is_active=false on rows
-- that haven't already been flipped).

-- --- Schema ----------------------------------------------------------------
ALTER TABLE public.source_companies
  ADD COLUMN IF NOT EXISTS consecutive_failures int NOT NULL DEFAULT 0;
ALTER TABLE public.source_companies
  ADD COLUMN IF NOT EXISTS auto_deactivated_at timestamptz;
ALTER TABLE public.source_companies
  ADD COLUMN IF NOT EXISTS auto_deactivated_reason text;

-- --- Data: deactivate dead Greenhouse slugs (404s, companies moved off GH) -
UPDATE public.source_companies SET
  is_active = false,
  auto_deactivated_at = COALESCE(auto_deactivated_at, now()),
  auto_deactivated_reason = COALESCE(auto_deactivated_reason, 'Greenhouse board no longer exists (404)')
WHERE source = 'greenhouse'
  AND slug IN ('segment', 'square', 'atlassian', 'etsy', 'snap', 'coinbase')
  AND is_active = true;

-- --- Data: deactivate dead Lever orgs (moved to other ATSes) --------------
UPDATE public.source_companies SET
  is_active = false,
  auto_deactivated_at = COALESCE(auto_deactivated_at, now()),
  auto_deactivated_reason = COALESCE(auto_deactivated_reason, 'Org migrated off Lever (404)')
WHERE source = 'lever' AND slug IN ('brex', 'mixpanel')
  AND is_active = true;

-- --- Data: dedupe no-slug drivers (only need one row per source) ----------
WITH ranked AS (
  SELECT id, source,
         row_number() OVER (PARTITION BY source ORDER BY created_at) AS rn
  FROM public.source_companies
  WHERE source IN ('arbeitnow', 'remoteok', 'remotive')
    AND is_active = true
)
UPDATE public.source_companies SET
  is_active = false,
  auto_deactivated_at = COALESCE(auto_deactivated_at, now()),
  auto_deactivated_reason = COALESCE(auto_deactivated_reason, 'Duplicate row — no-slug driver only needs one')
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- --- Data: deactivate drivers requiring env keys that aren't set by default
-- Operator opt-in: add the key to backend/.env then UPDATE … SET is_active=true
UPDATE public.source_companies SET
  is_active = false,
  auto_deactivated_at = COALESCE(auto_deactivated_at, now()),
  auto_deactivated_reason = COALESCE(auto_deactivated_reason, 'Requires API key not set by default — opt-in by setting env var')
WHERE source IN ('usajobs', 'jooble', 'adzuna')
  AND is_active = true;

-- --- Data: deactivate paid / quota-heavy drivers by default ---------------
-- Same opt-in story — these cost money or share fragile RapidAPI quotas.
UPDATE public.source_companies SET
  is_active = false,
  auto_deactivated_at = COALESCE(auto_deactivated_at, now()),
  auto_deactivated_reason = COALESCE(auto_deactivated_reason, 'Paid / quota-heavy driver — opt-in only')
WHERE source IN ('linkedin', 'monster', 'searchapi', 'serpapi', 'jsearch')
  AND is_active = true;

NOTIFY pgrst, 'reload schema';
