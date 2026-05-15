-- HireOrbit AI — align the Training catalog with the I-983 STEM-OPT
-- Training Plan standard.
--
-- The DHS I-983 ("Training Plan for STEM OPT Students") requires the employer
-- to attest to + document several specific things:
--   1. Goals and objectives of the training (Section 5)
--   2. Specific knowledge, skills, or techniques the student will learn
--   3. How those will help reach the student's career goals
--   4. How the employer will oversee + assess the student (methods + cadence)
--   5. Weekly hours + wage commensurate with similarly-situated US workers
--   6. The student's STEM degree (degree level + CIP code)
--   7. The employer's E-Verify number + EIN
--   8. A 12-month self-evaluation and a final evaluation, signed by both
--      the student and the supervisor.
--
-- This migration extends our training tables so each assignment can carry the
-- full I-983 payload, and adds a training_evaluations table for the two
-- mandatory evaluations. The existing courses are also enriched with
-- learning_objectives / skills_taught / assessment_methods / stem_relevance
-- so they read like a formal training module instead of a study guide.
--
-- Idempotent. Safe to re-run.

-- ===========================================================================
-- COURSE METADATA — I-983 Section 6 source fields
-- ===========================================================================
alter table public.training_courses
  add column if not exists learning_objectives text[],     -- 4–6 measurable bullets
  add column if not exists skills_taught       text[],     -- technical + soft skills
  add column if not exists assessment_methods  text[],     -- e.g. quiz, project, code-review
  add column if not exists stem_relevance      text,       -- 1–2 sentences tying to STEM degree
  add column if not exists weekly_hours        numeric(4,1); -- typical hours/week of focused training

-- ===========================================================================
-- ASSIGNMENT METADATA — I-983 employer / oversight / wage attestation
-- ===========================================================================
alter table public.training_assignments
  add column if not exists employer_name          text,
  add column if not exists employer_address       text,
  add column if not exists employer_ein           text,        -- IRS Employer Identification Number
  add column if not exists employer_everify_no    text,        -- E-Verify company ID (required for STEM-OPT)
  add column if not exists supervisor_name        text,
  add column if not exists supervisor_title       text,
  add column if not exists supervisor_email       text,
  add column if not exists oversight_method       text,        -- how supervisor monitors progress
  add column if not exists wage_amount            numeric(10,2),
  add column if not exists wage_basis             text,        -- HOURLY or SALARY
  add column if not exists weekly_hours           numeric(4,1),
  add column if not exists stem_degree            text,        -- e.g. "MS Computer Science"
  add column if not exists stem_cip_code          text,        -- e.g. "11.0701"
  add column if not exists training_start_date    date,
  add column if not exists training_end_date      date;

-- ===========================================================================
-- TRAINING EVALUATIONS — the I-983 12-month + final evaluations
-- ===========================================================================
do $$ begin
  create type training_evaluation_kind as enum (
    'SELF_12_MONTH', 'FINAL', 'SUPERVISOR_INTERIM'
  );
exception when duplicate_object then null; end $$;

create table if not exists public.training_evaluations (
  id uuid primary key default gen_random_uuid(),
  assignment_id     uuid not null references public.training_assignments(id) on delete cascade,
  kind              training_evaluation_kind not null,
  evaluation_date   date not null default current_date,
  -- Section A — progress against objectives (free text, will be printed verbatim)
  goals_progress    text,
  -- Section B — specific knowledge / skills / techniques actually acquired
  skills_acquired   text,
  -- Section C — hours completed in this evaluation period
  hours_completed   numeric(6,1),
  -- Section D — supervisor narrative (only for SUPERVISOR_INTERIM / FINAL)
  supervisor_notes  text,
  -- Performance rating 1..5 (FINAL only — optional)
  rating            int check (rating between 1 and 5),
  -- Signatures (DHS only accepts wet OR docusign signatures — these are the
  -- printable name + date we render onto the I-983 PDF or print copy).
  student_signature_name text,
  student_signed_at      timestamptz,
  supervisor_signature_name text,
  supervisor_signed_at      timestamptz,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists training_evals_assignment_idx on public.training_evaluations (assignment_id);
create index if not exists training_evals_kind_idx       on public.training_evaluations (kind);

drop trigger if exists trg_training_evaluations_updated_at on public.training_evaluations;
create trigger trg_training_evaluations_updated_at before update on public.training_evaluations
  for each row execute function public.set_updated_at();

alter table public.training_evaluations enable row level security;

-- ===========================================================================
-- BACKFILL — populate I-983 metadata on the existing seeded courses
-- ===========================================================================

update public.training_courses set
  learning_objectives = array[
    'Build production REST APIs using Spring Boot auto-configuration and starter dependencies',
    'Apply input validation with @Valid and produce structured 4xx/5xx error envelopes',
    'Persist domain models with Spring Data JPA repositories and JPQL',
    'Implement stateless authentication with Spring Security + JWT',
    'Author unit, slice, and integration tests against a Testcontainers Postgres',
    'Package and deploy a Spring Boot service in a Docker image'
  ],
  skills_taught = array[
    'Spring Boot','Spring MVC','Spring Data JPA','Spring Security','JPA/Hibernate',
    'JWT authentication','Bean validation','RESTful API design','Testcontainers',
    'Maven/Gradle','Docker','Twelve-Factor configuration'
  ],
  assessment_methods = array[
    'End-of-module multiple-choice quiz (≥80% passing)',
    'Capstone project: a 4-endpoint Job API with auth, validation, persistence, tests',
    'Supervisor code review of the capstone with a 1–5 rubric'
  ],
  stem_relevance = 'Directly applies the software engineering coursework from the student''s Computer Science / Software Engineering / Information Systems degree. Builds the production-Java backend skills required for the engagement.',
  weekly_hours = 6
where title = 'Spring Boot Foundations';

update public.training_courses set
  learning_objectives = array[
    'Author strictly-typed React components with TypeScript generics',
    'Manage state and side effects with the React hooks model',
    'Share state via Context and custom hooks without prop-drilling',
    'Implement client-side routing and accessible forms (react-hook-form + Zod)',
    'Fetch data with React Query and cover happy + error paths with Testing Library'
  ],
  skills_taught = array[
    'React 18','TypeScript','React Hooks','React Router v6','react-hook-form',
    'Zod schema validation','React Query','Vitest','React Testing Library','Tailwind CSS'
  ],
  assessment_methods = array[
    'Module quiz at the end of each chapter',
    'Capstone: a 3-page React app mirroring the HireOrbit AI frontend (login → list → detail)',
    'Supervisor review of pull request quality + test coverage'
  ],
  stem_relevance = 'Builds the frontend competency expected of a Software Engineer / Frontend Engineer in modern web-application development — a direct extension of the CS / Web Development coursework in the student''s STEM degree.',
  weekly_hours = 5
where title = 'React + TypeScript Crash Course';

update public.training_courses set
  learning_objectives = array[
    'Design least-privilege IAM roles + policies for service-to-service auth',
    'Provision elastic compute with EC2 + Auto Scaling Groups behind ALBs',
    'Use S3 lifecycle, bucket policies, and presigned URLs correctly',
    'Build serverless APIs with Lambda + API Gateway (HTTP API v2)',
    'Pick between RDS and DynamoDB based on access pattern',
    'Wire structured logs, metrics, and alarms in CloudWatch',
    'Deploy infrastructure via AWS CDK'
  ],
  skills_taught = array[
    'AWS IAM','EC2','Auto Scaling','ELB','S3','Lambda','API Gateway','RDS','DynamoDB',
    'CloudWatch','CDK (TypeScript)','VPC','Security Groups'
  ],
  assessment_methods = array[
    'Hands-on lab: deploy a Lambda + API Gateway service with CDK',
    'Quiz on IAM policy authoring',
    'Capstone: end-to-end alarmed service with documented run-book'
  ],
  stem_relevance = 'Cloud infrastructure is core to modern software engineering and data engineering. This module gives the student the AWS production skills that map directly to their CS / CIS / Data Engineering degree.',
  weekly_hours = 8
where title = 'AWS for Engineers';

update public.training_courses set
  learning_objectives = array[
    'Structure a 30-minute system design interview using the FRAME method',
    'Perform capacity estimation: QPS, storage, bandwidth, server count',
    'Choose data models that match the access pattern (SQL vs NoSQL)',
    'Apply caching, sharding, and queueing as scale levers correctly',
    'Walk through complete designs for a feed system, a ride-hailing service, and a messaging service'
  ],
  skills_taught = array[
    'System design','Capacity planning','Distributed-systems trade-offs',
    'Caching strategies','Database sharding','Message queues','Whiteboard interview communication'
  ],
  assessment_methods = array[
    'Three written design documents (one per case study)',
    'Recorded mock interview reviewed against a rubric',
    'Quiz on cache + sharding pattern selection'
  ],
  stem_relevance = 'Senior software engineering interviews require the candidate to apply distributed-systems concepts from a CS degree at whiteboard speed. This is the bridge between coursework and the engagement-readiness interview.',
  weekly_hours = 4
where title = 'Interview Prep: System Design';

update public.training_courses set
  learning_objectives = array[
    'Produce a weekly written status update that reduces follow-up traffic',
    'Run a client kickoff call with a structured 30-minute agenda',
    'Write async messages that an executive can read in 20 seconds',
    'Raise risks and escalate without burning client trust',
    'Drive a productive 1:1 with a manager / mentor'
  ],
  skills_taught = array[
    'Technical writing','Stakeholder management','Async communication',
    'Risk escalation','Meeting facilitation','1:1 coaching'
  ],
  assessment_methods = array[
    'Submit a personal communication kit (status template + kickoff agenda + 1:1 template)',
    'Supervisor review of one real status email + one real 1:1 agenda'
  ],
  stem_relevance = 'Supplemental to the technical skills of the STEM degree — communication is required to deliver software engineering work in a client / consulting context, which is the practical training environment the student is in.',
  weekly_hours = 3
where title = 'Communication Skills for Consultants';

update public.training_courses set
  learning_objectives = array[
    'Identify the timing, eligibility, and limits of post-completion OPT and the STEM extension',
    'Report every change to the DSO and SEVIS within the required 10 days',
    'Track unemployment days to stay within the 90- / 150-day cumulative limits',
    'Complete the I-983 Training Plan accurately for any new STEM-OPT period',
    'Produce the 12-month self-evaluation and final evaluation as required',
    'Plan the H-1B cap-gap transition without losing work authorization',
    'Maintain an audit-ready document set for the full F-1 period'
  ],
  skills_taught = array[
    'F-1 OPT regulations','SEVIS reporting','I-983 authoring','Self-evaluation writing',
    'Cap-gap planning','International travel rules','Document retention'
  ],
  assessment_methods = array[
    'Quiz on OPT eligibility + the 10-day rule',
    'Practice I-983: student fills a blank I-983 with their actual engagement data, reviewed by supervisor',
    'Audit checklist: student demonstrates the monthly 10-minute compliance review'
  ],
  stem_relevance = 'Required compliance education for any F-1 student on OPT / STEM-OPT. Pairs with the technical training modules — without this, mistakes in the I-983 or SEVIS reporting can terminate F-1 status mid-engagement.',
  weekly_hours = 2
where title = 'OPT / STEM-OPT Compliance Playbook';

-- ===========================================================================
-- Final touches
-- ===========================================================================
notify pgrst, 'reload schema';
