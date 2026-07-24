-- Mirror of backend/migrations/1700000000002_daily_digest_flag.sql for the
-- fresh-install path (database/init.sql via build-init-sql.mjs).
INSERT INTO public.feature_flags (key, enabled, description)
VALUES ('daily_digest', false, 'Nightly per-consultant top-5 job-match email digest')
ON CONFLICT (key) DO NOTHING;

NOTIFY pgrst, 'reload schema';
