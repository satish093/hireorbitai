-- HireOrbit AI — Training completion gates (STEM OPT spec).
--
-- The base training schema (training.sql) treats a course as "complete" as
-- soon as every lesson row is checked off. The STEM OPT compliance spec
-- requires a stronger guarantee:
--
--   A course is COMPLETED only when every gate has passed:
--     1. all lessons completed (training_lesson_progress)
--     2. minimum time on lessons met (sum(time_spent_minutes) >= minimum_time_minutes)
--     3. quizzes passed at or above passing_score
--     4. required assignments submitted (training_assignment_uploads)
--     5. acknowledgement recorded (training_acknowledgements)
--     6. final assessment passed (training_final_assessments)
--     7. manager approval when requires_manager_approval = true
--
-- This migration adds the columns + tables needed to evaluate every gate
-- server-side. The actual gating logic lives in
-- backend/src/services/training.service.ts (recalcAssignmentStatus) and is
-- NEVER trusted from the frontend.
--
-- Idempotent. Safe to re-run.

-- ===========================================================================
-- COURSE-LEVEL completion configuration
-- ===========================================================================
alter table public.training_courses
  add column if not exists compliance_category       text,
  add column if not exists minimum_time_minutes      int,           -- aggregate across lessons
  add column if not exists required_completion_score numeric(5,2),  -- 0..100; final-assessment cutoff
  add column if not exists quiz_passing_score        numeric(5,2),  -- 0..100; quiz cutoff
  add column if not exists quiz_max_attempts         int,           -- null = unlimited
  add column if not exists requires_manager_approval boolean not null default false,
  add column if not exists trainer_user_id           uuid references public.users(id) on delete set null,
  add column if not exists expected_outcomes         text[],
  add column if not exists related_job_duties        text[];

-- Compliance categories are spec-defined. Free-text column + CHECK constraint
-- so we keep flexibility but reject typos. NULL is allowed (legacy rows).
do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'training_courses_compliance_category_chk'
  ) then
    alter table public.training_courses
      add constraint training_courses_compliance_category_chk
      check (
        compliance_category is null or compliance_category in (
          'Technical Training',
          'Client Project Preparation',
          'Tool Training',
          'Domain Training',
          'Communication Training',
          'Security Training',
          'Process Training'
        )
      );
  end if;
end $$;

create index if not exists training_courses_trainer_idx
  on public.training_courses (trainer_user_id);

-- ===========================================================================
-- LESSON-LEVEL gates
-- ===========================================================================
alter table public.training_lessons
  add column if not exists lesson_objective          text,
  add column if not exists practical_example         text,
  add column if not exists knowledge_check_required  boolean not null default false,
  add column if not exists minimum_time_minutes      int;

-- ===========================================================================
-- QUIZ ATTEMPT — store the full attempt envelope per spec
-- ===========================================================================
-- Existing rows have selected_answer (text). The spec wants the full picked
-- set (jsonb) plus an attempt counter and an explicit pass flag.
alter table public.training_quiz_attempts
  add column if not exists attempt_number  int,
  add column if not exists selected_answers jsonb,
  add column if not exists passed           boolean;

-- Backfill attempt_number + passed for any pre-existing rows so the
-- "attempt count" gate is consistent. The window function partitions by
-- (assignment, quiz) and orders by attempted_at; the first attempt is #1.
update public.training_quiz_attempts a
set attempt_number = sub.rn,
    passed = coalesce(a.passed, a.is_correct)
from (
  select id, row_number() over (
    partition by assignment_id, quiz_id
    order by attempted_at asc
  ) as rn
  from public.training_quiz_attempts
) sub
where a.id = sub.id and (a.attempt_number is null or a.passed is null);

create index if not exists tqa_assignment_quiz_idx
  on public.training_quiz_attempts (assignment_id, quiz_id, attempt_number);

-- ===========================================================================
-- FINAL ASSESSMENT — one row per assignment when authored
-- ===========================================================================
do $$ begin
  create type training_final_assessment_kind as enum (
    'MULTIPLE_CHOICE', 'SHORT_ANSWER', 'PRACTICAL_ASSIGNMENT', 'MANAGER_REVIEW'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type training_final_assessment_status as enum (
    'PENDING', 'SUBMITTED', 'APPROVED', 'REJECTED'
  );
exception when duplicate_object then null; end $$;

create table if not exists public.training_final_assessments (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.training_assignments(id) on delete cascade,
  assessment_type training_final_assessment_kind not null,
  questions   jsonb,        -- the prompt set (authored by manager / AI)
  answers     jsonb,        -- consultant's submission
  score       numeric(5,2), -- 0..100
  passed      boolean,
  manager_feedback text,
  approval_status training_final_assessment_status not null default 'PENDING',
  approved_by uuid references public.users(id) on delete set null,
  approved_at timestamptz,
  submitted_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (assignment_id)
);
create index if not exists training_final_assessments_status_idx
  on public.training_final_assessments (approval_status);

drop trigger if exists trg_training_final_assessments_updated_at
  on public.training_final_assessments;
create trigger trg_training_final_assessments_updated_at
  before update on public.training_final_assessments
  for each row execute function public.set_updated_at();

alter table public.training_final_assessments enable row level security;

-- ===========================================================================
-- ACKNOWLEDGEMENT — consultant attests they understand the material
-- ===========================================================================
-- One row per (assignment, user). The same consultant can't both have two
-- acknowledgements and skip one (unique key on assignment_id covers the
-- one-assignment-one-user invariant since assignments themselves are
-- unique per (course, user)).
create table if not exists public.training_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.training_assignments(id) on delete cascade,
  user_id       uuid not null references public.users(id) on delete cascade,
  acknowledgement_text text not null,
  ip_address inet,
  user_agent text,
  acknowledged_at timestamptz not null default now(),
  unique (assignment_id)
);
create index if not exists training_acknowledgements_user_idx
  on public.training_acknowledgements (user_id);

alter table public.training_acknowledgements enable row level security;

-- ===========================================================================
-- SUPERVISION NOTES — weekly trainer/manager observations
-- ===========================================================================
-- training_feedback already exists for "rating + free-text after submission".
-- Supervision notes are different: they're a running journal of weekly
-- observations the trainer keeps about the consultant's progress. Spec
-- requires the structured fields (skill_progress, next_steps, etc.) so we
-- model it as a separate table rather than overload feedback.
create table if not exists public.training_supervision_notes (
  id uuid primary key default gen_random_uuid(),
  assignment_id    uuid not null references public.training_assignments(id) on delete cascade,
  trainer_user_id  uuid not null references public.users(id) on delete restrict,
  note             text not null,
  skill_progress   text,
  areas_for_improvement text,
  observed_performance text,
  next_steps       text,
  observed_on      date not null default current_date,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists tsn_assignment_idx
  on public.training_supervision_notes (assignment_id, observed_on desc);
create index if not exists tsn_trainer_idx
  on public.training_supervision_notes (trainer_user_id);

drop trigger if exists trg_training_supervision_notes_updated_at
  on public.training_supervision_notes;
create trigger trg_training_supervision_notes_updated_at
  before update on public.training_supervision_notes
  for each row execute function public.set_updated_at();

alter table public.training_supervision_notes enable row level security;

-- ===========================================================================
-- ASSIGNMENT STATUS — extend the enum to cover every spec state
-- ===========================================================================
-- Postgres requires ALTER TYPE ... ADD VALUE outside a transaction block in
-- versions < 12. PG 12+ allows it inside transactions. The do-block + IF NOT
-- EXISTS pattern is safe on every supported version.
do $$ begin
  alter type training_assignment_status add value if not exists 'QUIZ_PENDING';
exception when others then null; end $$;
do $$ begin
  alter type training_assignment_status add value if not exists 'ASSIGNMENT_PENDING';
exception when others then null; end $$;
do $$ begin
  alter type training_assignment_status add value if not exists 'FINAL_ASSESSMENT_PENDING';
exception when others then null; end $$;
do $$ begin
  alter type training_assignment_status add value if not exists 'MANAGER_REVIEW_PENDING';
exception when others then null; end $$;
do $$ begin
  alter type training_assignment_status add value if not exists 'FAILED';
exception when others then null; end $$;

-- ===========================================================================
-- BACKFILL — set sensible defaults on the seeded courses so the gates work
-- ===========================================================================
update public.training_courses
   set quiz_passing_score        = coalesce(quiz_passing_score, 80),
       required_completion_score = coalesce(required_completion_score, 80),
       quiz_max_attempts         = coalesce(quiz_max_attempts, 3),
       requires_manager_approval = coalesce(requires_manager_approval, true)
 where status = 'ACTIVE';

-- Map seeded courses to a compliance category so reports group cleanly.
update public.training_courses
   set compliance_category = case category
     when 'Spring Boot'              then 'Technical Training'
     when 'React'                    then 'Technical Training'
     when 'AWS'                      then 'Tool Training'
     when 'Interview Preparation'    then 'Client Project Preparation'
     when 'Communication Skills'     then 'Communication Training'
     when 'OPT / STEM-OPT Compliance' then 'Process Training'
     else compliance_category
   end
 where compliance_category is null;

-- ===========================================================================
-- Final touches
-- ===========================================================================
notify pgrst, 'reload schema';
