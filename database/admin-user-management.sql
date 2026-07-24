-- =============================================================================
-- Admin user-management migration
--
-- Adds the columns + enum the admin "All Users" surface needs:
--   - status: 5-state enum (active / inactive / suspended / pending_verification / banned)
--   - status_reason / status_changed_at / status_changed_by: who/when/why
--   - last_login_at: filled on every successful sign-in
--   - notes: free-text admin notes ("VIP client", "spam recruiter", etc.)
--
-- Auth middleware reads `status` and refuses any non-`active` value, so
-- changing the status is sufficient to lock a user out — refresh tokens are
-- additionally revoked at the API layer (see auth.service.ts).
--
-- Idempotent: safe to re-run.
-- =============================================================================

-- 1. Status enum -------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'user_status') then
    create type user_status as enum (
      'active',
      'inactive',
      'suspended',
      'pending_verification',
      'banned'
    );
  end if;
end $$;

-- 2. Add the new columns ------------------------------------------------------
alter table public.users
  add column if not exists status              user_status not null default 'active',
  add column if not exists status_reason       text,
  add column if not exists status_changed_at   timestamptz,
  add column if not exists status_changed_by   uuid references public.users(id) on delete set null,
  add column if not exists last_login_at       timestamptz,
  add column if not exists admin_notes         text;

comment on column public.users.status is
  '5-state account status. Auth middleware refuses any non-`active` value.';
comment on column public.users.status_reason is
  'Free-text reason set by the admin when status moves away from active.';
comment on column public.users.status_changed_by is
  'public.users.id of the admin who last changed the status.';
comment on column public.users.last_login_at is
  'Stamped on every successful sign-in by /auth/login.';
comment on column public.users.admin_notes is
  'Internal admin notes — never exposed to non-admins.';

-- 3. Backfill: existing is_active → status -----------------------------------
-- If the legacy is_active column exists and is false, mark them inactive.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'users' and column_name = 'is_active'
  ) then
    update public.users
       set status = 'inactive'
     where is_active = false
       and status = 'active';
  end if;
end $$;

-- 4. Indexes for admin filtering ---------------------------------------------
create index if not exists users_status_idx          on public.users (status);
create index if not exists users_role_status_idx     on public.users (role, status);
create index if not exists users_last_login_at_idx   on public.users (last_login_at desc nulls last);

-- 5. Audit log additions -----------------------------------------------------
-- The auth_audit_logs.action column is just `text`, so we don't need a schema
-- change. The new actions the admin surface will write are:
--   admin_user_status_changed
--   admin_user_password_reset
--   admin_user_deactivated     (status -> inactive/suspended/banned)
--   admin_user_reactivated     (status -> active)
--   admin_user_deleted         (hard delete via db.auth.admin.deleteUser)
--   admin_user_impersonated    (future)
