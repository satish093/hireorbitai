-- Criteria-based daily job alerts.
--
-- Layers per-user filters on top of the existing on/off users.job_alerts
-- toggle. The daily digest (services/digest.service.ts) reads these to narrow
-- what it emails a consultant: keyword + location filters, a remote-only
-- switch, and a personal minimum match score.
--
-- One row per user (PK = user_id). Absence of a row = "no extra criteria",
-- so the digest falls back to its global defaults — reads are fail-open.
--
-- Idempotent: safe to re-run.

create table if not exists public.user_job_alert_prefs (
  user_id     uuid primary key references public.users (id) on delete cascade,
  keywords    text[]      not null default '{}',
  locations   text[]      not null default '{}',
  remote_only boolean     not null default false,
  min_match   integer     not null default 60 check (min_match >= 0 and min_match <= 100),
  job_function text,
  updated_at  timestamptz not null default now()
);

notify pgrst, 'reload schema';
