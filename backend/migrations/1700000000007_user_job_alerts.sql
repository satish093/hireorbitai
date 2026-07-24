-- Per-user job-alert opt-in. Controls whether the daily match digest emails
-- this user. Defaults true so enabling the `daily_digest` flag keeps emailing
-- active consultants as before; users can opt out from the jobs app. Idempotent.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS job_alerts boolean NOT NULL DEFAULT true;

NOTIFY pgrst, 'reload schema';
