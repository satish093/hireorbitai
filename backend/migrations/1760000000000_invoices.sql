-- HireOrbit AI — invoices: consultant invoice tracker.
--
-- Free-text consultant + vendor names (standalone finance tracker, not linked
-- to the consultants/vendors tables), invoice/due dates, net terms, and a
-- status workflow. Back-office module gated to MANAGER_TIER + the `invoices`
-- feature flag (see routes/index.ts).
--
-- Idempotent: safe to re-run.

create table if not exists public.invoices (
  id              uuid primary key default gen_random_uuid(),
  consultant_name text not null,
  vendor_name     text not null,
  invoice_number  text,
  invoice_date    date,
  due_date        date,
  net_terms_days  integer,
  status          text not null default 'Submitted'
                    check (status in ('Submitted', 'Approved', 'Paid', 'Overdue', 'Cancelled')),
  notes           text,
  created_by      uuid references public.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists invoices_status_due_idx on public.invoices (status, due_date);
create index if not exists invoices_created_idx on public.invoices (created_at desc);

-- Feature flag (mirrors tasks / training / interviews), default ON so the
-- module is visible to MANAGER_TIER as soon as the migration applies.
insert into public.feature_flags (key, description, enabled)
values ('invoices', 'Consultant invoice tracking', true)
on conflict (key) do nothing;

notify pgrst, 'reload schema';
