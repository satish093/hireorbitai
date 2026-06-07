-- Per-group company logo.
--
--   logo_path — filesystem storage path of the uploaded logo, relative to the
--               'group-logos' bucket (e.g. '<groupId>/<ts>-acme.png'). NULL when
--               the group has no logo (it then falls back to its color dot).
--
-- We store the storage PATH, not a URL: download URLs are HMAC-signed and
-- short-lived (minted per response in the controller), so a persisted URL would
-- go stale. The userGroups controller mints a fresh signed `logo_url` from this
-- path on each list/create/update response.
--
-- Nullable + idempotent: the backend deploys ahead of this migration (the upload
-- handler degrades to a 503 "migration not applied" on the schema-cache error).

alter table public.user_groups add column if not exists logo_path text;

notify pgrst, 'reload schema';
