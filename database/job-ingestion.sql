-- HireOrbit AI — Live job ingestion (Jobright-style)
-- Idempotent: safe to re-run.

-- Identify which source pulled the job, the original ID at that source, and
-- a deep-link the user can follow to apply on the company site.
alter table public.jobs add column if not exists source text;
alter table public.jobs add column if not exists external_id text;
alter table public.jobs add column if not exists apply_url text;
alter table public.jobs add column if not exists company_name text;
alter table public.jobs add column if not exists last_synced_at timestamptz;

-- Dedupe by source + external_id. Multiple jobs with NULL source are still
-- allowed (locally-created jobs).
create unique index if not exists jobs_source_external_uniq
  on public.jobs (source, external_id)
  where source is not null and external_id is not null;
create index if not exists jobs_source_idx on public.jobs (source);

-- source_companies: the slugs (Greenhouse / Lever / etc.) we want to ingest
-- from. SUPER_ADMIN / MANAGER can add to this list; the ingestion service
-- iterates over it on every sync.
create table if not exists public.source_companies (
  id uuid primary key default gen_random_uuid(),
  source text not null,                    -- 'greenhouse' | 'lever' | 'remoteok' | 'adzuna'
  slug text,                                -- company slug for greenhouse/lever
  display_name text,
  is_active boolean not null default true,
  added_by uuid references public.users(id) on delete set null,
  last_synced_at timestamptz,
  last_sync_jobs_count int,
  last_sync_error text,
  created_at timestamptz not null default now(),
  unique (source, slug)
);
create index if not exists source_companies_active_idx
  on public.source_companies (source, is_active);

alter table public.source_companies enable row level security;

-- Pre-seed a few well-known Greenhouse + Lever companies so the first sync
-- returns real jobs immediately. (Hiring statuses fluctuate; some may return 0
-- jobs at any given moment.)
insert into public.source_companies (source, slug, display_name) values
  ('greenhouse', 'anthropic', 'Anthropic'),
  ('greenhouse', 'stripe', 'Stripe'),
  ('greenhouse', 'airbnb', 'Airbnb'),
  ('greenhouse', 'figma', 'Figma'),
  ('greenhouse', 'doordash', 'DoorDash'),
  ('greenhouse', 'discord', 'Discord'),
  ('greenhouse', 'gitlab', 'GitLab'),
  ('lever', 'netflix', 'Netflix'),
  ('lever', 'plaid', 'Plaid'),
  ('lever', 'brex', 'Brex'),
  ('lever', 'mixpanel', 'Mixpanel'),
  ('remoteok', null, 'RemoteOK')
on conflict (source, slug) do nothing;
