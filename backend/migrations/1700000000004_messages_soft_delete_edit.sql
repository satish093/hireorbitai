-- Phase 2 of the messaging-permission overhaul.
--
-- Adds two audit columns to public.messages so messages can be soft-deleted
-- and (eventually) edited without losing history. Idempotent.
--
--   deleted_at — sender retracts a message. Filtered out of all SELECTs at
--                the controller layer. Row is preserved for compliance /
--                audit until a future retention job purges old soft-deletes.
--   edited_at — set when the sender edits the body. Body itself stays in
--                place; if we ever ship full edit history we'd add a
--                message_edits table.

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS edited_at timestamptz;

-- Index so the deleted_at IS NULL filter in /conversations and /thread
-- doesn't full-scan as the table grows. Partial index — only NON-deleted
-- rows are indexed, which is the only set we ever query.
CREATE INDEX IF NOT EXISTS messages_active_recipient_idx
  ON public.messages (recipient_id, read_at, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS messages_active_pair_idx
  ON public.messages (sender_id, recipient_id, created_at DESC)
  WHERE deleted_at IS NULL;

NOTIFY pgrst, 'reload schema';
