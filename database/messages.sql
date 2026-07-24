-- HireOrbit AI — direct messaging
-- Simple 1:1 DMs. Sender + recipient are both users; read_at is set when the
-- recipient first opens the thread.
-- Idempotent: safe to re-run.

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.users(id) on delete cascade,
  recipient_id uuid not null references public.users(id) on delete cascade,
  body text not null,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  -- A user can't DM themselves.
  check (sender_id <> recipient_id)
);

-- Recipient inbox + unread lookups.
create index if not exists messages_recipient_idx
  on public.messages (recipient_id, read_at, created_at desc);
-- Thread lookup (both directions).
create index if not exists messages_pair_idx
  on public.messages (sender_id, recipient_id, created_at desc);
create index if not exists messages_pair_reverse_idx
  on public.messages (recipient_id, sender_id, created_at desc);

alter table public.messages enable row level security;
