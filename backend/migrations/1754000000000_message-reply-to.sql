-- HireOrbit AI — reply-to quoting on direct messages.
--
-- Adds a single nullable FK back to messages so a reply can render the
-- parent message as a quoted preview (Discord/Slack-style). The schema is
-- intentionally minimal — the preview text + sender are computed on read
-- from the parent row, not denormalised here, so editing the parent
-- updates every quote of it for free.
--
-- ON DELETE SET NULL: when a parent message is retracted, its replies
-- stay in the thread but lose the "replying to" pill (Slack's behaviour
-- when the original is deleted). Cascading would orphan-delete replies
-- which is more destructive than the user expects.
-- Idempotent: safe to re-run.

alter table public.messages
  add column if not exists reply_to_message_id uuid
    references public.messages(id) on delete set null;

-- Powers "show me all replies to this message" if we ever surface that;
-- also helps the read path resolve a batch of parents in a single query.
create index if not exists messages_reply_to_idx
  on public.messages (reply_to_message_id);
