-- HireOrbit AI — drop the Accounts / Finance schema.
--
-- Only run this if you already applied database/accounts.sql and now want
-- the tables gone. Drops everything in dependency order so the FKs don't
-- block.
--
-- WARNING: this destroys all data in those tables.

drop table if exists public.recruiter_commissions cascade;
drop table if exists public.consultant_payroll    cascade;
drop table if exists public.transactions          cascade;
drop table if exists public.payments              cascade;
drop table if exists public.invoice_line_items    cascade;
drop table if exists public.invoices              cascade;
drop table if exists public.timesheets            cascade;
drop table if exists public.placements            cascade;
drop table if exists public.expenses              cascade;
drop table if exists public.expense_categories    cascade;

drop type if exists commission_status         cascade;
drop type if exists payroll_status            cascade;
drop type if exists expense_status            cascade;
drop type if exists transaction_direction     cascade;
drop type if exists transaction_kind          cascade;
drop type if exists payment_method            cascade;
drop type if exists invoice_status            cascade;
drop type if exists timesheet_status          cascade;
drop type if exists placement_status          cascade;
drop type if exists placement_payment_terms   cascade;
drop type if exists placement_commission_type cascade;
drop type if exists placement_billing_type    cascade;

notify pgrst, 'reload schema';
