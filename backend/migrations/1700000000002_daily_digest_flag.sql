-- Seed the daily_digest feature flag. Idempotent: re-runs are no-ops.
-- Default OFF so the new scheduler doesn't start spending Anthropic + Brevo
-- the moment this migration applies; admins flip it on at /admin/feature-flags
-- when they're ready.

INSERT INTO public.feature_flags (key, enabled, description)
VALUES ('daily_digest', false, 'Nightly per-consultant top-5 job-match email digest')
ON CONFLICT (key) DO NOTHING;

NOTIFY pgrst, 'reload schema';
