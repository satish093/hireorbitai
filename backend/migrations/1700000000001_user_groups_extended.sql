-- Forward migration: extend user_groups with a display ID + color, and add
-- group_id to invitations so the inviter can pre-assign a group.
--
-- This file mirrors database/user-groups-extended.sql verbatim. The other
-- path (manual `psql -f database/init.sql`) is for fresh-install operators;
-- this one is for the canonical node-pg-migrate flow that auto-deploy uses.
-- Both files are idempotent so applying them through either path — or both
-- — is safe.

-- Up
create sequence if not exists public.user_groups_display_seq start 1;

alter table public.user_groups
  add column if not exists unique_group_id text;

update public.user_groups
   set unique_group_id = 'GRP-' || lpad(nextval('public.user_groups_display_seq')::text, 4, '0')
 where unique_group_id is null;

alter table public.user_groups
  alter column unique_group_id
  set default ('GRP-' || lpad(nextval('public.user_groups_display_seq')::text, 4, '0'));

do $$ begin
  alter table public.user_groups
    add constraint user_groups_unique_group_id_key unique (unique_group_id);
exception when duplicate_table then null; when duplicate_object then null; end $$;

alter table public.user_groups
  add column if not exists color text not null default '#6366F1';

alter table public.invitations
  add column if not exists group_id uuid
  references public.user_groups(id) on delete set null;

create index if not exists invitations_group_idx on public.invitations (group_id);

notify pgrst, 'reload schema';
