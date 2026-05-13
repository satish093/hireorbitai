-- =============================================================================
-- Auth hardening migration
--
-- Adds the columns + tables required by the enterprise auth flow:
--   - first-login forced password change
--   - custom (Brevo-backed) forgot-password flow
--   - auth audit trail
--   - account lockout after failed logins
-- Idempotent: safe to re-run.
-- =============================================================================

-- --- public.users additions --------------------------------------------------
alter table public.users
  add column if not exists must_change_password           boolean      default true,
  add column if not exists temporary_password_sent_at     timestamptz,
  add column if not exists last_password_changed_at       timestamptz,
  add column if not exists password_expires_at            timestamptz,
  add column if not exists failed_login_attempts          integer      default 0,
  add column if not exists locked_until                   timestamptz;

comment on column public.users.must_change_password is
  'True if the user signed in with a temp password and has not yet rotated it. Blocks all routes until cleared.';
comment on column public.users.temporary_password_sent_at is
  'When the most recent temporary password was issued. Combined with the 24h expiry check at login.';
comment on column public.users.password_expires_at is
  'Optional hard expiry for the current password. Null = no expiry.';

-- --- password_reset_tokens ---------------------------------------------------
-- Stores hashed reset tokens. The raw token is only ever known to the user
-- (delivered in the Brevo email). We index by user_id so cleanup is cheap.
create table if not exists public.password_reset_tokens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete cascade,
  token_hash  text not null,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  ip_address  text,
  created_at  timestamptz default now()
);

create index if not exists password_reset_tokens_user_id_idx
  on public.password_reset_tokens (user_id);

-- A single-column index on token_hash gives us O(log n) lookup at validation
-- time. Unique constraint guards against accidental duplicate inserts.
create unique index if not exists password_reset_tokens_token_hash_uidx
  on public.password_reset_tokens (token_hash);

-- --- auth_audit_logs ---------------------------------------------------------
-- One row per security-relevant event. Append-only. Frontend never queries
-- this directly — only ops via the audit UI / Grafana.
create table if not exists public.auth_audit_logs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid,
  email       text,
  action      text not null,
  -- e.g. 'login_success', 'login_failed', 'logout',
  --      'password_changed', 'password_reset_requested', 'password_reset_completed',
  --      'account_locked', 'admin_created_user', 'must_change_password_enforced'
  ip_address  text,
  user_agent  text,
  metadata    jsonb,
  created_at  timestamptz default now()
);

create index if not exists auth_audit_logs_user_id_created_idx
  on public.auth_audit_logs (user_id, created_at desc);

create index if not exists auth_audit_logs_action_created_idx
  on public.auth_audit_logs (action, created_at desc);

-- --- Cleanup function: expired reset tokens ----------------------------------
-- Schedule via pg_cron or your existing job runner; or call manually:
--   select public.purge_expired_password_reset_tokens();
create or replace function public.purge_expired_password_reset_tokens()
returns integer
language plpgsql
as $$
declare
  deleted integer;
begin
  delete from public.password_reset_tokens
   where expires_at < now() - interval '7 days'
      or used_at is not null and used_at < now() - interval '7 days';
  get diagnostics deleted = row_count;
  return deleted;
end;
$$;

-- --- RLS — both new tables are server-only (service-role) for now ------------
alter table public.password_reset_tokens enable row level security;
alter table public.auth_audit_logs        enable row level security;
-- No client-facing policies. The backend uses the service_role key which
-- bypasses RLS. If you ever want admins to read auth_audit_logs from the
-- client, add a SELECT policy keyed off public.users.role.
