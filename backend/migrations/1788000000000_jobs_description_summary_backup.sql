-- Zero-cost, non-AI fallback for description_summary: a heuristic excerpt
-- (first few sentences of the raw description, no gateway call) populated
-- by the HACP scraper's job-summary agent for every job immediately, so a
-- job always has something short to show while description_summary is
-- pending or permanently failing. See job_summary_agent.py on the Hermes
-- box (backfill_backups()). Idempotent: safe to re-run.

alter table public.jobs add column if not exists description_summary_backup text;

notify pgrst, 'reload schema';
