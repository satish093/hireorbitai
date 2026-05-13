-- TalentBridge AI — three coupled features:
--   1) Online/idle/offline presence: a last_seen_at heartbeat on users.
--   2) User groups (multi-tenant style: Cloudfen, Zangle IT, Xeronix, Okta Solutions).
--   3) Per-group feature flag overrides so the same flag can be on for one
--      group and off for another.
--
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- 1) PRESENCE
-- ---------------------------------------------------------------------------
alter table public.users
  add column if not exists last_seen_at timestamptz;
create index if not exists users_last_seen_idx on public.users (last_seen_at desc);

-- ---------------------------------------------------------------------------
-- 2) USER GROUPS
-- ---------------------------------------------------------------------------
create table if not exists public.user_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,            -- url-safe; used by API + flag overrides
  description text,
  is_active boolean not null default true,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists user_groups_active_idx on public.user_groups (is_active);

alter table public.users
  add column if not exists group_id uuid references public.user_groups(id) on delete set null;
create index if not exists users_group_idx on public.users (group_id);

-- Seed the four groups the team uses today. ON CONFLICT keeps re-runs safe.
insert into public.user_groups (name, slug, description) values
  ('Cloudfen',       'cloudfen',       'Cloudfen consulting bench'),
  ('Zangle IT',      'zangle-it',      'Zangle IT consulting bench'),
  ('Xeronix',        'xeronix',        'Xeronix consulting bench'),
  ('Okta Solutions', 'okta-solutions', 'Okta Solutions consulting bench')
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- 3) PER-GROUP FEATURE FLAG OVERRIDES
--   When a row exists here for (group_id, key), it takes precedence over the
--   global feature_flags row for users in that group. NULL row = inherit global.
-- ---------------------------------------------------------------------------
create table if not exists public.group_feature_flags (
  group_id uuid not null references public.user_groups(id) on delete cascade,
  key text not null,                    -- mirrors feature_flags.key
  enabled boolean not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id) on delete set null,
  primary key (group_id, key)
);

alter table public.user_groups       enable row level security;
alter table public.group_feature_flags enable row level security;

-- ---------------------------------------------------------------------------
-- Tell Supabase's PostgREST to reload its schema cache *now*. Without this
-- the newly created tables / columns are sometimes invisible to API calls
-- for up to a minute (and the symptom is a confusing "schema cache" error).
-- ---------------------------------------------------------------------------
notify pgrst, 'reload schema';
