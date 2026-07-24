-- HireOrbit AI — support / bug-report tickets.
--
-- Any authenticated user can file a structured bug report (severity, summary,
-- repro steps, the page URL it was filed from). Developers + admin-tier see
-- every ticket; everyone else sees only their own (enforced in the controller).
--
-- Idempotent: safe to re-run.

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.users (id) on delete cascade,
  severity text not null default 'low', -- low | medium | high | critical
  summary text not null,
  steps text,
  page_url text,
  status text not null default 'open', -- open | in_progress | resolved | closed
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists support_tickets_reporter_idx
  on public.support_tickets (reporter_id, created_at desc);

create index if not exists support_tickets_status_idx
  on public.support_tickets (status, created_at desc);
