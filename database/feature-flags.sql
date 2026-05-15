-- HireOrbit AI — Feature flags
-- Super admin can toggle modules on/off here. Backend exposes them on
-- GET /api/feature-flags; the sidebar + routes read these to hide modules.
-- Idempotent: safe to re-run.

create table if not exists public.feature_flags (
  key text primary key,
  enabled boolean not null default true,
  description text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id) on delete set null
);

insert into public.feature_flags (key, description, enabled) values
  ('messages',          'Direct messaging (Inbox)',                    true),
  ('tasks',             'Task tracker (board, list, comments)',        true),
  ('ai_match',          'AI job match scores on Jobs page',            true),
  ('ai_email',          'AI vendor-email generator',                   true),
  ('job_ingestion',     'Live job ingestion from Greenhouse / Lever',  true),
  ('interviews',        'Interview scheduling',                        true),
  ('reminders',         'Reminders / follow-ups',                      true),
  ('reports',           'Reports module',                              true),
  ('training',          'Training / Learning module',                  true)
on conflict (key) do nothing;

alter table public.feature_flags enable row level security;
