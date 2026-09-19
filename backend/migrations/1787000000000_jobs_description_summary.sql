-- Structured Markdown summary of a job's full description, built by a local
-- (non-AI) text extractor on the HACP scraper box before sync (see
-- job_summary_agent.py, hacpWebhook.controller.ts) — never generated in this
-- backend. Stays null for any job pushed before that agent existed, or if a
-- given row's description didn't parse. Idempotent: safe to re-run.

alter table public.jobs add column if not exists description_summary text;

notify pgrst, 'reload schema';
