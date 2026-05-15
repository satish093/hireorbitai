-- HireOrbit AI — per-user time-in-app tracking.
--
-- Piggybacks on the existing presence heartbeat (auth middleware fires every
-- 30s per active user). Each heartbeat upserts +30s into today's row. Time in
-- the app is therefore the sum of `active_seconds` across the requested
-- date range.
--
-- Idempotent: safe to re-run.

create table if not exists public.user_activity_daily (
  user_id uuid not null references public.users(id) on delete cascade,
  activity_date date not null,
  active_seconds integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, activity_date)
);

create index if not exists user_activity_daily_date_idx
  on public.user_activity_daily (activity_date desc);
create index if not exists user_activity_daily_user_idx
  on public.user_activity_daily (user_id, activity_date desc);

alter table public.user_activity_daily enable row level security;

notify pgrst, 'reload schema';
