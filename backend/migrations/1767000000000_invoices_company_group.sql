-- Invoice issuing company.
--
--   company_group_id — the user group (= company, e.g. "Zangle Technologies")
--                      that issues this invoice. Its name + uploaded logo brand
--                      the generated PDF's letterhead. NULL → the PDF falls back
--                      to the platform default brand.
--
-- Nullable + ON DELETE SET NULL so deleting a company just un-brands its
-- invoices rather than cascading. The controller strips this field and retries
-- on the schema-cache error, so the backend can deploy ahead of the migration.

alter table public.invoices
  add column if not exists company_group_id uuid references public.user_groups(id) on delete set null;

notify pgrst, 'reload schema';
