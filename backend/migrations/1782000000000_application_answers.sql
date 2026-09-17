-- Saved answers to common job-application questions (work authorization,
-- sponsorship, years of experience, etc. — see
-- shared/src/applicationQuestions.ts for the fixed catalog). Lets a consultant
-- answer a question once and have the Application Copilot reuse it on future
-- applications instead of re-asking.
--
-- `question_hash` = sha256 of the catalog's stable `key`, not the display
-- text, so editing question wording later doesn't orphan a saved answer.
-- `question_text` is a denormalized snapshot for display/audit only.
--
-- Idempotent: safe to re-run.

create table if not exists public.application_answers (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.users(id) on delete cascade,
  question_hash  text not null,
  question_text  text not null,
  answer         text not null,
  source         text not null default 'user'
                   check (source in ('user', 'profile', 'previous_application', 'generated')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (user_id, question_hash)
);

notify pgrst, 'reload schema';
