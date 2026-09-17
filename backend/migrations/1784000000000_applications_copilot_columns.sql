-- Columns needed for the LinkedIn Application Copilot flow, added to the
-- existing applications table rather than a parallel one (resume_id,
-- consultant_id, job_id, status, application_events, etc. already exist and
-- are reused as-is).
--
-- `application_type` distinguishes how an application reached SUBMITTED:
-- the pre-existing staffing/VMS flow ('staffing', the default meaning for
-- every pre-existing row — left null rather than backfilled, since null
-- already reads correctly as "not part of the new copilot"), the guided
-- LinkedIn wizard ('linkedin_copilot'), or a consultant's own quick
-- "I already applied on LinkedIn directly" log ('linkedin_external').
--
-- `submitted_at` becomes nullable: the copilot creates a draft application
-- row well before actual submission (duplicate-check, resume/cover-letter
-- assembly, review), and explicitly inserts `submitted_at: null` for that
-- draft state (applicationCopilot.service.ts) rather than relying on the
-- column default. It's set explicitly, once, at the real confirm-submission
-- step (`submitted_at: new Date().toISOString()`).
--
-- The `default now()` stays, though: NewSubmissionModal.tsx's manual
-- "log a submission" flow (the pre-existing staffing path, still the primary
-- production usage today) never sends submitted_at at all — it relies
-- entirely on that default. Dropping it would silently write NULL for every
-- real staffing submission going forward, so only NOT NULL is relaxed here.
--
-- Idempotent: safe to re-run.

alter table public.applications add column if not exists cover_letter_text text;
alter table public.applications add column if not exists cover_letter_source text
  check (cover_letter_source in ('ai_generated', 'user_edited'));
alter table public.applications add column if not exists application_type text
  check (application_type in ('staffing', 'linkedin_copilot', 'linkedin_external'));
alter table public.applications add column if not exists error_code text;
alter table public.applications add column if not exists error_message text;

alter table public.applications alter column submitted_at drop not null;

notify pgrst, 'reload schema';
