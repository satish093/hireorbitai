-- Persistent, account-level LinkedIn connection (Sign In with LinkedIn using
-- OpenID Connect — identity only; LinkedIn has no public job-search or
-- application-submission API for third-party apps). One row per user.
--
-- `encrypted_refresh_token`/`refresh_token_expires_at` are nullable and will
-- typically stay null: LinkedIn does not issue a refresh token at this OIDC
-- product tier, so the realistic renewal path is the user reconnecting, not a
-- silent refresh. `status` intentionally omits 'connecting'/'refreshing' —
-- those were transient states in the original design that add no value over
-- a synchronous OAuth callback; the backend never leaves a row in a
-- half-connected state.
--
-- Idempotent: safe to re-run.

create table if not exists public.linkedin_connections (
  id                        uuid primary key default gen_random_uuid(),
  user_id                   uuid not null unique references public.users(id) on delete cascade,
  linkedin_member_id        text not null,
  encrypted_access_token    text not null,
  encrypted_refresh_token   text,
  access_token_expires_at   timestamptz not null,
  refresh_token_expires_at  timestamptz,
  scopes                    text[] not null default '{}',
  status                    text not null default 'connected'
                              check (status in ('connected', 'reauthorization_required', 'disconnected')),
  connected_at              timestamptz not null default now(),
  last_verified_at          timestamptz,
  last_used_at              timestamptz,
  disconnected_at           timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create index if not exists idx_linkedin_connections_status
  on public.linkedin_connections (status);

notify pgrst, 'reload schema';
