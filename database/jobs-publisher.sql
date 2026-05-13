-- TalentBridge AI — record the publishing board (LinkedIn, Dice, Monster,
-- CareerBuilder, Indeed, Glassdoor, ZipRecruiter, …) for each job. Aggregators
-- like JSearch surface `job_publisher` on every result; we store it so the UI
-- can show & filter by the user-facing brand name even though all of those
-- listings technically came in through one driver.
--
-- Idempotent: safe to re-run.

alter table public.jobs
  add column if not exists publisher text;

create index if not exists jobs_publisher_idx
  on public.jobs (publisher);
