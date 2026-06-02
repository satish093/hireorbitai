-- HireOrbit AI — add the missing `notes` column to interviews.
--
-- The Schedule-interview modal and the create/update Zod schemas have a free-text
-- `notes` field, but the interviews table never had the column — so every
-- schedule / reschedule INSERT/UPDATE that carried `notes` failed with a generic
-- "Database error". The controller now strips `notes` and retries when the column
-- is absent (so it deploys ahead of this migration); applying this lets notes
-- actually persist.
--
-- Idempotent: safe to re-run.

alter table public.interviews add column if not exists notes text;

notify pgrst, 'reload schema';
