-- Company billing email for the user group (company).
--
--   email — the issuing company's contact/billing email, shown on the invoice
--           letterhead / From block / footer. Optional. Free-form like the rest
--           of the group profile.
--
-- Nullable + idempotent. The userGroups controller strips/ignores it on the
-- schema-cache error path so the backend can deploy ahead of this migration.

alter table public.user_groups add column if not exists email text;

notify pgrst, 'reload schema';
