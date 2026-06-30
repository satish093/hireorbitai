-- Invoice-level name + description fields.
--
-- `name`        — a short human title for the invoice (e.g. "March retainer").
-- `description` — a longer free-text description (distinct from per-line-item
--                 descriptions and from the existing `notes`).
-- Both nullable. Idempotent.

alter table public.invoices
  add column if not exists name        text,
  add column if not exists description text;

notify pgrst, 'reload schema';
