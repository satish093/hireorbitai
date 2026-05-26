-- Per-account capability grants for the configurable DEVELOPER role ("scoped
-- super-admin"). A DEVELOPER has no tier access by default; each capability the
-- super-admin ticks on is appended here. Other roles ignore this column.
-- Idempotent + safe in any environment (defaults to an empty grant set).
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS capabilities text[] NOT NULL DEFAULT '{}'::text[];
