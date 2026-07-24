-- Add parent assignment columns to the invitations table.
-- Stores who the invited user should be placed under in the org hierarchy,
-- whether the assignment was automatic or manually overridden, and who made
-- the override decision.
ALTER TABLE public.invitations
  ADD COLUMN IF NOT EXISTS parent_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_mode  text DEFAULT 'auto'
                                          CHECK (assigned_mode IN ('auto', 'manual')),
  ADD COLUMN IF NOT EXISTS assigned_by    uuid REFERENCES public.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS invitations_parent_user_id_idx
  ON public.invitations(parent_user_id)
  WHERE parent_user_id IS NOT NULL;
