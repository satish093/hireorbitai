-- ---------------------------------------------------------------------------
-- Reminders delivery tracking
--
-- The reminders dispatcher (backend/src/jobs/reminders.job.ts) needs to retry
-- transient Brevo failures rather than dropping reminders on the floor. These
-- columns let it count attempts, back off, and ultimately give up after N
-- tries so a permanent error (bad recipient, etc.) doesn't loop forever.
--
-- Safe to apply on a live DB — additive only, no data movement.
-- ---------------------------------------------------------------------------

alter table public.reminders
  add column if not exists delivery_attempts int not null default 0,
  add column if not exists delivery_last_error text,
  add column if not exists delivery_next_attempt_at timestamptz;

comment on column public.reminders.delivery_attempts is
  'Number of times the dispatcher has tried to send this reminder via Brevo.';
comment on column public.reminders.delivery_last_error is
  'Last error message from a failed Brevo send. Cleared on success.';
comment on column public.reminders.delivery_next_attempt_at is
  'Earliest time the dispatcher should retry after a failure (exponential backoff).';

-- Speeds up the dispatcher query that filters PENDING + due + retry-window.
create index if not exists reminders_dispatch_idx
  on public.reminders (status, due_at)
  where status = 'PENDING';
