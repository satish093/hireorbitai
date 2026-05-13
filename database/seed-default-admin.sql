-- =============================================================================
-- Seed the default SUPER_ADMIN account.
--
-- Standalone-safe: re-declares the auth-hardening columns it depends on, so
-- this file works whether or not `auth-hardening.sql` has been applied yet.
-- Apply `auth-hardening.sql` afterwards to get the rest (reset tokens, audit
-- logs, indexes, cleanup function, RLS).
--
-- Idempotent: re-running resets the password back to the default and re-arms
-- must_change_password=true.
--
-- Default credentials:
--   email:    satish.flex07@gmail.com
--   password: Admin2123
--   role:     SUPER_ADMIN
--
-- The account is flagged must_change_password=true so the first sign-in is
-- forced through `/change-password` — the well-known default becomes
-- unusable as soon as it's rotated, which is the whole point of this flow.
-- =============================================================================

-- pgcrypto provides crypt() / gen_salt() — Supabase enables it by default,
-- but we re-declare here so this file is self-contained.
create extension if not exists pgcrypto;

-- Required columns on public.users. These also live in auth-hardening.sql,
-- but we declare them here too so the seed runs cleanly in any order.
-- `add column if not exists` makes both files repeatable.
alter table public.users
  add column if not exists must_change_password           boolean      default true,
  add column if not exists temporary_password_sent_at     timestamptz,
  add column if not exists last_password_changed_at       timestamptz,
  add column if not exists password_expires_at            timestamptz,
  add column if not exists failed_login_attempts          integer      default 0,
  add column if not exists locked_until                   timestamptz;

do $$
declare
  v_email       text := 'satish.flex07@gmail.com';
  v_password    text := 'Admin2123';
  v_full_name   text := 'Satish';
  v_role        text := 'SUPER_ADMIN';
  v_user_id     uuid;
  v_existing_id uuid;
begin
  -- 1. Look up the auth.users row by email. We branch on whether it exists
  --    so we can hit both the "fresh install" and the "re-run / rotate"
  --    paths without duplicate-key explosions.
  select id into v_existing_id from auth.users where email = v_email limit 1;

  if v_existing_id is null then
    -- Fresh insert. Build a complete auth.users row.
    v_user_id := gen_random_uuid();
    insert into auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      is_super_admin,
      created_at,
      updated_at,
      confirmation_token,
      email_change,
      email_change_token_new,
      recovery_token
    ) values (
      '00000000-0000-0000-0000-000000000000',
      v_user_id,
      'authenticated',
      'authenticated',
      v_email,
      crypt(v_password, gen_salt('bf')),
      now(),
      jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
      jsonb_build_object('full_name', v_full_name, 'bootstrap', true),
      false,
      now(),
      now(),
      '',
      '',
      '',
      ''
    );

    -- The companion identities row is what supabase-js looks at when
    -- signInWithPassword runs. Without it, the auth row exists but logins
    -- silently fail with "Invalid login credentials".
    insert into auth.identities (
      provider_id,
      user_id,
      identity_data,
      provider,
      last_sign_in_at,
      created_at,
      updated_at
    ) values (
      v_user_id::text,
      v_user_id,
      jsonb_build_object(
        'sub',            v_user_id::text,
        'email',          v_email,
        'email_verified', true
      ),
      'email',
      now(),
      now(),
      now()
    );

    raise notice 'Created auth.users row for %', v_email;
  else
    -- Account already exists — reset the password back to the default and
    -- re-confirm the email. Keeps the same user id so foreign keys (tasks,
    -- audit logs, etc.) stay intact.
    v_user_id := v_existing_id;
    update auth.users
       set encrypted_password = crypt(v_password, gen_salt('bf')),
           email_confirmed_at = coalesce(email_confirmed_at, now()),
           updated_at         = now()
     where id = v_user_id;
    raise notice 'Reset password for existing auth.users row %', v_user_id;
  end if;

  -- 2. Upsert the matching public.users row with admin role + force a
  --    password change on first sign-in. The auth-hardening migration has
  --    already added the must_change_password / temporary_password_sent_at
  --    columns this references.
  -- `public.users.role` is a custom enum (`user_role`), not text — Postgres
  -- won't auto-cast a text variable, so we cast explicitly. The cast works
  -- regardless of which schema owns the enum.
  insert into public.users (
    id,
    email,
    full_name,
    role,
    must_change_password,
    temporary_password_sent_at,
    failed_login_attempts,
    locked_until,
    is_active
  ) values (
    v_user_id,
    v_email,
    v_full_name,
    v_role::user_role,
    true,
    now(),
    0,
    null,
    true
  )
  on conflict (id) do update set
    email                      = excluded.email,
    full_name                  = excluded.full_name,
    role                       = v_role::user_role,
    must_change_password       = true,
    temporary_password_sent_at = now(),
    failed_login_attempts      = 0,
    locked_until               = null,
    is_active                  = true,
    updated_at                 = now();

  raise notice 'Admin ready: %  /  %  /  role=%  (must_change_password=true)',
    v_email, v_password, v_role;
end $$;
