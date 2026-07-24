-- Offer expiry timestamp on an application, used by the dashboard urgent-items
-- feed (GET /activity/urgent) to surface offers expiring soon. Nullable;
-- handlers degrade gracefully (skip the offers signal) until this is applied.
-- Idempotent.

ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS offer_expires_at timestamptz;
