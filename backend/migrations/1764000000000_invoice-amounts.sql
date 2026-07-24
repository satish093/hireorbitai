-- Finance fields for the consultant invoice tracker:
--   pay_rate       — hourly/contract pay rate for the consultant
--   billing_month  — the month being invoiced (stored as 'YYYY-MM' free text)
--   invoice_amount — the total amount of the invoice
--
-- All nullable so the tracker stays free-form (a row is valid with just the
-- consultant + vendor names). Controllers strip these fields and retry if the
-- column isn't present yet, so the backend can deploy ahead of this migration.
--
-- Idempotent: safe to re-run.

alter table public.invoices add column if not exists pay_rate numeric(12, 2);
alter table public.invoices add column if not exists billing_month text;
alter table public.invoices add column if not exists invoice_amount numeric(12, 2);

notify pgrst, 'reload schema';
