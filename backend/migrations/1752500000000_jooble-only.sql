-- Switch to Jooble-only ingestion (Dice + Monster + CareerBuilder filtered).
-- Removes all previous source rows and seeds three Jooble query rows.

DELETE FROM public.source_companies
WHERE source NOT IN ('manual');

INSERT INTO public.source_companies (source, slug, display_name, is_active)
VALUES
  ('jooble', 'software engineer', 'Jooble — Software Engineer', true),
  ('jooble', 'data engineer',     'Jooble — Data Engineer',     true),
  ('jooble', 'java developer',    'Jooble — Java Developer',    true)
ON CONFLICT (source, slug) DO UPDATE
  SET is_active              = true,
      consecutive_failures   = 0,
      auto_deactivated_at    = NULL,
      auto_deactivated_reason = NULL;

NOTIFY pgrst, 'reload schema';
