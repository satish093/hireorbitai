-- First-run product tour tracking. `tour_completed_at` is null until the user
-- finishes (or skips) the guided profile/app tour; set to now() at that point.
-- Storing it server-side (instead of localStorage) makes the "seen" state
-- durable across devices and browsers. Idempotent.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS tour_completed_at timestamptz;

NOTIFY pgrst, 'reload schema';
