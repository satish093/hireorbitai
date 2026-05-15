-- HireOrbit AI — many-to-many recruiter ↔ manager / director assignment
-- A recruiter can now report into multiple managers / directors at once.
-- Backfills from the existing single-manager column on recruiters.
-- Idempotent: safe to re-run.

create table if not exists public.recruiter_managers (
  recruiter_id uuid not null references public.recruiters(id) on delete cascade,
  manager_id uuid not null references public.users(id) on delete cascade,
  -- "primary" — used by reports/dashboards when a single "lead" is needed.
  -- The first row inserted for a recruiter is marked primary automatically.
  is_primary boolean not null default false,
  assigned_by uuid references public.users(id) on delete set null,
  assigned_at timestamptz not null default now(),
  primary key (recruiter_id, manager_id)
);

create index if not exists recruiter_managers_recruiter_idx
  on public.recruiter_managers (recruiter_id);
create index if not exists recruiter_managers_manager_idx
  on public.recruiter_managers (manager_id);

-- Only one primary per recruiter.
create unique index if not exists recruiter_managers_one_primary_per_recruiter
  on public.recruiter_managers (recruiter_id) where is_primary;

alter table public.recruiter_managers enable row level security;

-- Backfill: if a recruiter already has a manager_id, mirror it into the new
-- table as the primary assignment.
insert into public.recruiter_managers (recruiter_id, manager_id, is_primary)
select id, manager_id, true
from public.recruiters
where manager_id is not null
on conflict (recruiter_id, manager_id) do nothing;
