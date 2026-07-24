-- ---------------------------------------------------------------------------
-- Saved task filters
--
-- Per-user named filter presets for the Tasks page. Filter criteria is stored
-- as JSONB so the schema doesn't need to migrate every time a new filter
-- field is added on the frontend (status, priority, assignee_id, etc.).
--
-- One row per (user_id, name). is_default is enforced via a partial unique
-- index so each user has at most one default. Mutations cascade with the
-- user delete.
-- ---------------------------------------------------------------------------

create table if not exists public.task_filters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  name text not null,
  criteria jsonb not null default '{}'::jsonb,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Name length sane upper bound; trim handled at the API.
  constraint task_filters_name_len check (char_length(name) between 1 and 80)
);

-- Unique per user + name so listing is predictable and renames can't collide.
create unique index if not exists task_filters_user_name_unique
  on public.task_filters (user_id, lower(name));

-- At most one default per user — partial unique index makes this cheap.
create unique index if not exists task_filters_user_default_unique
  on public.task_filters (user_id)
  where is_default;

create index if not exists task_filters_user_idx
  on public.task_filters (user_id, created_at desc);

-- Standard updated_at trigger. Re-uses the global helper if it exists, else
-- defines a local one. The DO block keeps this migration idempotent.
do $$
begin
  if not exists (select 1 from pg_proc where proname = 'set_updated_at') then
    create or replace function public.set_updated_at()
    returns trigger language plpgsql as $fn$
    begin
      new.updated_at = now();
      return new;
    end;
    $fn$;
  end if;
end$$;

drop trigger if exists task_filters_set_updated_at on public.task_filters;
create trigger task_filters_set_updated_at
  before update on public.task_filters
  for each row execute function public.set_updated_at();
