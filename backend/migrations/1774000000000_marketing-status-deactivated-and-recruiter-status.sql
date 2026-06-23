-- Add a DEACTIVATED marketing status and give recruiters their own status.
--
--   1. Extend the consultant_marketing_status enum with 'DEACTIVATED'. It's a
--      label only (no account/login side effects) — a way to park a consultant
--      off the active bench without deleting their row.
--   2. Recruiters previously had no status. Mirror the consultant vocabulary by
--      reusing the same enum on a new recruiters.marketing_status column,
--      defaulting to 'ACTIVE' so every existing recruiter stays active.
--
-- Idempotent: safe to re-run. `add value if not exists` (Postgres 12+) and
-- `add column if not exists` both no-op on a second pass.

alter type consultant_marketing_status add value if not exists 'DEACTIVATED';

alter table public.recruiters
  add column if not exists marketing_status consultant_marketing_status not null default 'ACTIVE';

notify pgrst, 'reload schema';
