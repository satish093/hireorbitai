-- HireOrbit AI — group-level co-management grants.
--
-- Lets an admin-tier user (DIRECTOR and up) grant a MANAGER / HR_MANAGER the
-- same group-lead scope over ANOTHER group — its recruiters, consultants,
-- pipeline and messaging — alongside that group's own lead. This is a
-- GROUP-level grant, not the per-recruiter recruiter_managers junction.
--
-- The backend deploys AHEAD of this migration: every query path guards on the
-- schema-cache error and degrades to home-group-only / "no grants", so shipping
-- the code before applying this file causes no 500s.
--
-- Idempotent: safe to re-run.

create table if not exists public.manager_group_grants (
  id uuid primary key default gen_random_uuid(),
  manager_id uuid not null references public.users(id) on delete cascade,
  group_id   uuid not null references public.user_groups(id) on delete cascade,
  granted_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (manager_id, group_id)
);

create index if not exists manager_group_grants_manager_idx
  on public.manager_group_grants (manager_id);
create index if not exists manager_group_grants_group_idx
  on public.manager_group_grants (group_id);

notify pgrst, 'reload schema';
