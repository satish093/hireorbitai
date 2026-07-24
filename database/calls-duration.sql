-- HireOrbit AI — record per-call duration so the org-wide monthly cap
-- (CALLS_MONTHLY_HOUR_CAP, default 980 hrs) can sum it cheaply.
--
-- The cap exists to bound Cloudflare Realtime TURN egress at the free
-- 1,000 GB/month tier. At ~80 kbps Opus, 980 hours of fully-relayed
-- audio is comfortably under that ceiling with headroom for both legs
-- of every call.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS so
-- re-applying on a VPS that already ran the migration is a no-op.
-- No data backfill is needed: historical calls without
-- duration_seconds simply don't contribute to the cap; calls.controller
-- end() will populate the column for every NEW accepted call going
-- forward, which is the only window the cap measures (calendar month).

ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS duration_seconds int;

-- Partial index keyed on started_at. The cap's aggregation is:
--   SELECT COALESCE(SUM(duration_seconds), 0) / 3600.0
--     FROM public.calls
--    WHERE status = 'ended'
--      AND duration_seconds IS NOT NULL
--      AND started_at >= date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
-- The WHERE predicate matches the partial index exactly, so the planner
-- can serve the whole sum from index-only data even when the calls
-- table grows large.
CREATE INDEX IF NOT EXISTS calls_started_at_idx
  ON public.calls (started_at)
  WHERE status = 'ended' AND duration_seconds IS NOT NULL;
