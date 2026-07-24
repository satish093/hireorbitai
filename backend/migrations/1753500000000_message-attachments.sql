-- HireOrbit AI — message attachments.
-- Lets a user attach images / docs / spreadsheets to a DM. Mirrors the
-- task_attachments table (database/tasks.sql) so the storage + signed-URL
-- patterns line up 1:1.
--
-- Two-phase upload: the file goes up via POST /messages/attachments BEFORE
-- the message is sent, creating an "orphan" row with message_id = NULL.
-- The subsequent POST /messages call passes attachment_ids and the
-- controller claims those orphans by setting message_id. A nightly job can
-- sweep orphans older than 24h (out of scope for this migration).
-- Idempotent: safe to re-run.

create table if not exists public.message_attachments (
  id uuid primary key default gen_random_uuid(),
  -- Nullable while the row is orphaned (uploaded but not yet attached to a
  -- sent message). The send handler updates this to the new message's id
  -- after the message row is created. Cascade-delete pulls attachments
  -- when the parent message is deleted.
  message_id uuid references public.messages(id) on delete cascade,
  uploaded_by uuid not null references public.users(id) on delete cascade,
  -- Intended recipient — captured at upload time so the orphan-cleanup
  -- job + permission checks can scope without joining through messages.
  recipient_user_id uuid references public.users(id) on delete set null,
  file_name text not null,
  storage_path text not null,
  mime_type text,
  size_bytes bigint,
  created_at timestamptz not null default now()
);

create index if not exists message_attachments_message_id_idx
  on public.message_attachments (message_id);
create index if not exists message_attachments_uploaded_by_idx
  on public.message_attachments (uploaded_by, created_at desc);
-- Used by the orphan-sweep job: WHERE message_id IS NULL AND created_at < now()-1d
create index if not exists message_attachments_orphans_idx
  on public.message_attachments (created_at)
  where message_id is null;
