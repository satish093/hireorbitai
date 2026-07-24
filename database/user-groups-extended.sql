-- HireOrbit AI — extend the user_groups feature with:
--   1) A human-readable display ID (GRP-0001, GRP-0002, ...) on each group,
--      auto-filled by a sequence so admins can refer to groups by short code.
--   2) A `color` swatch column for badge rendering on the admin UI.
--   3) A nullable `group_id` column on `invitations` so the inviter can pre-
--      assign the new user to a group at acceptance time (or leave it NULL
--      for the "No Group" path).
--
-- Fully idempotent — every column add is IF NOT EXISTS, every constraint is
-- wrapped in a duplicate_object guard. Safe to re-run.

-- ---------------------------------------------------------------------------
-- 1) Human-readable display ID — GRP-XXXX, sequence-backed.
-- ---------------------------------------------------------------------------
create sequence if not exists public.user_groups_display_seq start 1;

alter table public.user_groups
  add column if not exists unique_group_id text;

-- Backfill any existing rows that don't yet have a display ID.
update public.user_groups
   set unique_group_id = 'GRP-' || lpad(nextval('public.user_groups_display_seq')::text, 4, '0')
 where unique_group_id is null;

-- Lock in the default + uniqueness now that no NULLs remain.
alter table public.user_groups
  alter column unique_group_id
  set default ('GRP-' || lpad(nextval('public.user_groups_display_seq')::text, 4, '0'));

do $$ begin
  alter table public.user_groups
    add constraint user_groups_unique_group_id_key unique (unique_group_id);
exception when duplicate_table then null; when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 2) Color swatch — Tailwind-friendly hex string. NULLs aren't useful here
--    since the UI always wants to render a color, so default to indigo-500.
-- ---------------------------------------------------------------------------
alter table public.user_groups
  add column if not exists color text not null default '#6366F1';

-- ---------------------------------------------------------------------------
-- 3) Pre-assign a group at invitation time. NULL == "No Group" path.
-- ---------------------------------------------------------------------------
alter table public.invitations
  add column if not exists group_id uuid
  references public.user_groups(id) on delete set null;

create index if not exists invitations_group_idx on public.invitations (group_id);

notify pgrst, 'reload schema';
