-- Mirror of backend/migrations/1700000000004_messages_soft_delete_edit.sql
-- for the fresh-install path (database/init.sql via build-init-sql.mjs).
-- Idempotent.

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS edited_at timestamptz;

CREATE INDEX IF NOT EXISTS messages_active_recipient_idx
  ON public.messages (recipient_id, read_at, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS messages_active_pair_idx
  ON public.messages (sender_id, recipient_id, created_at DESC)
  WHERE deleted_at IS NULL;

NOTIFY pgrst, 'reload schema';
