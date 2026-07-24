-- Personal self-notes: a free-text scratchpad each user can keep about
-- themselves on their own profile. Distinct from `admin_notes` (admin-only) and
-- the recruiter/consultant `notes` columns.
--
-- Idempotent: safe to re-run.

alter table public.users
  add column if not exists self_notes text;

notify pgrst, 'reload schema';
