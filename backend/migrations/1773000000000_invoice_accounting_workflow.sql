-- Invoice accounting workflow.
-- Replaces the permissive tracker with company-scoped, calculated invoices.

-- Obsolete page grants must not survive the move back to role-only access.
update public.users
set capabilities = array_remove(capabilities, 'invoices')
where capabilities @> array['invoices']::text[];

alter table public.invoices drop constraint if exists invoices_status_check;

alter table public.invoices
  add column if not exists issuer_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists bill_to_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists currency text not null default 'USD',
  add column if not exists discount_amount numeric(14, 2) not null default 0,
  add column if not exists tax_percent numeric(7, 4) not null default 0,
  add column if not exists subtotal numeric(14, 2) not null default 0,
  add column if not exists tax_amount numeric(14, 2) not null default 0,
  add column if not exists total_amount numeric(14, 2) not null default 0,
  add column if not exists archived_at timestamptz,
  add column if not exists submitted_at timestamptz,
  add column if not exists approved_at timestamptz,
  add column if not exists paid_at timestamptz,
  add column if not exists cancelled_at timestamptz;

update public.invoices
set status = 'Approved',
    approved_at = coalesce(approved_at, updated_at, created_at)
where status = 'Overdue';

update public.invoices
set submitted_at = coalesce(submitted_at, created_at)
where status in ('Submitted', 'Approved', 'Paid');

update public.invoices
set approved_at = coalesce(approved_at, updated_at, created_at)
where status in ('Approved', 'Paid');

update public.invoices
set paid_at = coalesce(paid_at, updated_at, created_at)
where status = 'Paid';

update public.invoices
set cancelled_at = coalesce(cancelled_at, updated_at, created_at)
where status = 'Cancelled';

alter table public.invoices
  add constraint invoices_status_check
  check (status in ('Draft', 'Submitted', 'Approved', 'Paid', 'Cancelled')),
  add constraint invoices_currency_check
  check (currency ~ '^[A-Z]{3}$'),
  add constraint invoices_amounts_check
  check (
    discount_amount >= 0 and tax_percent >= 0 and tax_percent <= 100
    and subtotal >= 0 and tax_amount >= 0 and total_amount >= 0
  ),
  add constraint invoices_dates_check
  check (due_date is null or invoice_date is null or due_date >= invoice_date);

-- Historical snapshots: preserve the values visible at migration time.
update public.invoices i
set issuer_snapshot = jsonb_strip_nulls(jsonb_build_object(
      'name', g.name,
      'email', g.email
    ))
from public.user_groups g
where i.company_group_id = g.id
  and i.issuer_snapshot = '{}'::jsonb;

update public.invoices
set bill_to_snapshot = jsonb_strip_nulls(jsonb_build_object(
      'name', vendor_name,
      'email', bill_to_email
    ))
where bill_to_snapshot = '{}'::jsonb;

create table if not exists public.invoice_line_items (
  id             uuid primary key default gen_random_uuid(),
  invoice_id     uuid not null references public.invoices(id) on delete cascade,
  description    text not null,
  service_period text,
  quantity       numeric(14, 4) not null default 1 check (quantity > 0),
  unit           text not null default 'service',
  unit_rate      numeric(14, 4) not null default 0 check (unit_rate >= 0),
  amount         numeric(14, 2) not null default 0 check (amount >= 0),
  position       integer not null default 0 check (position >= 0),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists invoice_line_items_invoice_position_idx
  on public.invoice_line_items(invoice_id, position, id);

-- Backfill one calculated item per legacy invoice. When hours/quantity were not
-- stored, quantity=1 and unit_rate=the known invoice total preserves history.
insert into public.invoice_line_items
  (invoice_id, description, service_period, quantity, unit, unit_rate, amount, position)
select
  i.id,
  coalesce(nullif(i.consultant_name, ''), 'Professional consulting services'),
  i.billing_month,
  1,
  'service',
  coalesce(i.invoice_amount, 0),
  coalesce(i.invoice_amount, 0),
  0
from public.invoices i
where not exists (
  select 1 from public.invoice_line_items li where li.invoice_id = i.id
);

update public.invoices
set subtotal = coalesce(invoice_amount, 0),
    tax_amount = 0,
    discount_amount = 0,
    total_amount = coalesce(invoice_amount, 0)
where subtotal = 0 and total_amount = 0;

create table if not exists public.invoice_status_history (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid not null references public.invoices(id) on delete cascade,
  from_status text,
  to_status   text not null,
  changed_by uuid references public.users(id) on delete set null,
  changed_at timestamptz not null default now(),
  note        text
);

create index if not exists invoice_status_history_invoice_idx
  on public.invoice_status_history(invoice_id, changed_at desc);

with ranked as (
  select
    id,
    row_number() over (
      partition by company_group_id, lower(invoice_number)
      order by created_at, id
    ) as duplicate_rank
  from public.invoices
  where company_group_id is not null
    and invoice_number is not null
    and btrim(invoice_number) <> ''
)
update public.invoices i
set invoice_number = i.invoice_number || '-DUP-' || left(i.id::text, 8)
from ranked r
where i.id = r.id and r.duplicate_rank > 1;

create unique index if not exists invoices_company_number_unique_idx
  on public.invoices(company_group_id, lower(invoice_number))
  where company_group_id is not null
    and invoice_number is not null
    and btrim(invoice_number) <> '';

create index if not exists invoices_company_archived_due_idx
  on public.invoices(company_group_id, archived_at, due_date);

notify pgrst, 'reload schema';
