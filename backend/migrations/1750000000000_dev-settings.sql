-- Development-only key/value store for the Super-Admin test panel: test API
-- keys, SMTP settings, scraper configs, experimental flags. Only ever written
-- in a development environment (the /dev/* API is 404 in production). Safe to
-- apply in prod — the table simply stays empty and unreferenced.
CREATE TABLE IF NOT EXISTS public.dev_settings (
  key        text        NOT NULL PRIMARY KEY,
  value      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid        REFERENCES public.users (id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
