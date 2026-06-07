-- Invoice document email support.
--
--   bill_to_email   — where the generated invoice PDF is emailed when the user
--                     flips the "Email this invoice" toggle on. Free-form like
--                     the rest of the tracker (invoices store vendor/consultant
--                     NAMES, no FK, so there is no email to look up otherwise).
--   last_emailed_at — set server-side when an invoice PDF is emailed. Never
--                     client-writable (it is omitted from the controller's
--                     `writable` allowlist).
--
-- Both nullable. Controllers strip these fields and retry on the schema-cache
-- error so the backend can deploy ahead of this migration. Idempotent.

alter table public.invoices add column if not exists bill_to_email text;
alter table public.invoices add column if not exists last_emailed_at timestamptz;

notify pgrst, 'reload schema';
