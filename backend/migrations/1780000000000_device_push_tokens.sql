-- Device push tokens for hard (remote) push notifications.
--
-- One row per (user, device-token). A user can have several devices; a token
-- can be reassigned to a new user (log out / log in on a shared device), so the
-- token is the natural unique key and we re-point user_id on conflict.
--
-- `platform` distinguishes ios/android for payload shaping. `revoked_at` marks
-- a token the push provider reported as unregistered (DeviceNotRegistered) so
-- the dispatcher stops sending to dead devices without deleting history.
-- Idempotent.

create table if not exists public.device_push_tokens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  token       text not null unique,
  platform    text not null check (platform in ('ios','android')),
  created_at  timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at  timestamptz
);

create index if not exists idx_device_push_tokens_user
  on public.device_push_tokens (user_id) where revoked_at is null;

notify pgrst, 'reload schema';
