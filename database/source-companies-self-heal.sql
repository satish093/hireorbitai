-- Mirror of backend/migrations/1700000000003_source_company_self_heal.sql for
-- the fresh-install path (database/init.sql via build-init-sql.mjs).
-- Idempotent. See the migration file for the rationale comments.

ALTER TABLE public.source_companies
  ADD COLUMN IF NOT EXISTS consecutive_failures int NOT NULL DEFAULT 0;
ALTER TABLE public.source_companies
  ADD COLUMN IF NOT EXISTS auto_deactivated_at timestamptz;
ALTER TABLE public.source_companies
  ADD COLUMN IF NOT EXISTS auto_deactivated_reason text;

UPDATE public.source_companies SET
  is_active = false,
  auto_deactivated_at = COALESCE(auto_deactivated_at, now()),
  auto_deactivated_reason = COALESCE(auto_deactivated_reason, 'Greenhouse board no longer exists (404)')
WHERE source = 'greenhouse'
  AND slug IN ('segment', 'square', 'atlassian', 'etsy', 'snap', 'coinbase')
  AND is_active = true;

UPDATE public.source_companies SET
  is_active = false,
  auto_deactivated_at = COALESCE(auto_deactivated_at, now()),
  auto_deactivated_reason = COALESCE(auto_deactivated_reason, 'Org migrated off Lever (404)')
WHERE source = 'lever' AND slug IN ('brex', 'mixpanel')
  AND is_active = true;

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

UPDATE public.source_companies SET
  is_active = false,
  auto_deactivated_at = COALESCE(auto_deactivated_at, now()),
  auto_deactivated_reason = COALESCE(auto_deactivated_reason, 'Requires API key not set by default — opt-in by setting env var')
WHERE source IN ('usajobs', 'jooble', 'adzuna')
  AND is_active = true;

UPDATE public.source_companies SET
  is_active = false,
  auto_deactivated_at = COALESCE(auto_deactivated_at, now()),
  auto_deactivated_reason = COALESCE(auto_deactivated_reason, 'Paid / quota-heavy driver — opt-in only')
WHERE source IN ('linkedin', 'monster', 'searchapi', 'serpapi', 'jsearch')
  AND is_active = true;

NOTIFY pgrst, 'reload schema';
