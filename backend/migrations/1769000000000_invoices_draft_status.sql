-- Add a 'Draft' invoice status.
--
-- Drafts are auto-created (blank, pre-branded) when a company logo is uploaded
-- (see userGroups.controller uploadLogo). The original CHECK on invoices.status
-- is an inline, auto-named constraint (`invoices_status_check`); drop + re-add it
-- to include 'Draft'. Idempotent — safe to re-run.

alter table public.invoices drop constraint if exists invoices_status_check;
alter table public.invoices
  add constraint invoices_status_check
  check (status in ('Draft', 'Submitted', 'Approved', 'Paid', 'Overdue', 'Cancelled'));

notify pgrst, 'reload schema';
