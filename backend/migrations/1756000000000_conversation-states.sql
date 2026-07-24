-- HireOrbit AI — per-user conversation state (pin / archive).
--
-- A purely personal preference on a viewer's OWN inbox: which conversations
-- they've pinned to the top or archived out of the default view. Keyed by
-- (user_id, peer_id) so each side of a thread manages its own state
-- independently — pinning a conversation never affects the other party.
--
-- No data exposure: a row only ever records the owning user's UI preference,
-- so the write path needs no canMessage gate (it's self-scoped by user_id).
--
-- Idempotent: safe to re-run.

create table if not exists public.conversation_states (
  user_id uuid not null references public.users (id) on delete cascade,
  peer_id uuid not null references public.users (id) on delete cascade,
  pinned boolean not null default false,
  archived boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, peer_id)
);

create index if not exists conversation_states_user_idx
  on public.conversation_states (user_id);
