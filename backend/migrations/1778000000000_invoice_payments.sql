-- Invoice partial-payment ledger (Wave-style Paid / Due tracking).
--
-- Additive + idempotent: NO existing invoice data is removed. An invoice can now
-- be paid down over multiple payments; `amount_paid` is a maintained cache of the
-- ledger sum and `status` gains a 'Partially Paid' state between Approved and Paid.
--
-- Historical fully-Paid invoices are reconciled with one backfilled payment so the
-- ledger and amount_paid stay consistent with their existing Paid status.

-- 1. Per-invoice running paid total + reminder-throttle stamps.
alter table public.invoices
  add column if not exists amount_paid           numeric(14, 2) not null default 0,
  add column if not exists last_emailed_at       timestamptz,
  add column if not exists last_overdue_alert_at timestamptz;

alter table public.invoices drop constraint if exists invoices_amount_paid_check;
alter table public.invoices
  add constraint invoices_amount_paid_check check (amount_paid >= 0);

-- 2. Widen the status check to admit the new 'Partially Paid' state.
alter table public.invoices drop constraint if exists invoices_status_check;
alter table public.invoices
  add constraint invoices_status_check
  check (status in ('Draft', 'Submitted', 'Approved', 'Partially Paid', 'Paid', 'Cancelled'));

-- 3. The payment ledger. Append-only in normal use; a mis-keyed payment can be
--    voided (row removed) by a manager, which never touches invoice data.
create table if not exists public.invoice_payments (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid not null references public.invoices(id) on delete cascade,
  amount      numeric(14, 2) not null check (amount > 0),
  paid_on     date not null default current_date,
  method      text not null default 'other'
                check (method in ('bank_transfer', 'check', 'card', 'cash', 'ach', 'wire', 'other')),
  reference   text,
  note        text,
  recorded_by uuid references public.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists invoice_payments_invoice_idx
  on public.invoice_payments(invoice_id, paid_on desc, id);

-- 4. Backfill: every historically-Paid invoice gets a single reconciling payment
--    (if it has none) so its ledger sums to the total, then amount_paid is synced.
insert into public.invoice_payments (invoice_id, amount, paid_on, method, note)
select
  i.id,
  i.total_amount,
  coalesce(i.paid_at::date, i.updated_at::date, current_date),
  'other',
  'Reconciled from historical Paid status'
from public.invoices i
where i.status = 'Paid'
  and i.total_amount > 0
  and not exists (select 1 from public.invoice_payments p where p.invoice_id = i.id);

update public.invoices
set amount_paid = total_amount
where status = 'Paid' and amount_paid <> total_amount;

-- Index for the daily overdue-reminder job's scan.
create index if not exists invoices_overdue_scan_idx
  on public.invoices(status, due_date, last_overdue_alert_at)
  where archived_at is null;

notify pgrst, 'reload schema';
