-- HireOrbit AI — Training / LMS module.
--
-- Adds the schema for internal training: courses, lessons, assignments,
-- per-lesson progress, quizzes, quiz attempts, assignment uploads, and
-- manager feedback.
--
-- Backend uses service-role key (bypasses RLS). RLS is enabled with no
-- policies so direct PostgREST access from the anon key is blocked —
-- everything flows through /api/training/* with role checks.
--
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- ENUMS
-- ---------------------------------------------------------------------------
do $$ begin
  create type training_difficulty as enum ('BEGINNER', 'INTERMEDIATE', 'ADVANCED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type training_course_status as enum ('DRAFT', 'ACTIVE', 'ARCHIVED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type training_assignment_status as enum (
    'NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'OVERDUE'
  );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- COURSES
-- ---------------------------------------------------------------------------
create table if not exists public.training_courses (
  id uuid primary key default gen_random_uuid(),
  title         text not null,
  description   text,
  category      text not null,
  thumbnail_url text,
  difficulty    training_difficulty not null default 'BEGINNER',
  estimated_duration_hours numeric(6,2),
  tags          text[] not null default '{}',
  status        training_course_status not null default 'DRAFT',
  created_by    uuid references public.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists training_courses_status_idx   on public.training_courses (status);
create index if not exists training_courses_category_idx on public.training_courses (category);

-- ---------------------------------------------------------------------------
-- LESSONS — ordered children of a course.
-- ---------------------------------------------------------------------------
create table if not exists public.training_lessons (
  id uuid primary key default gen_random_uuid(),
  course_id    uuid not null references public.training_courses(id) on delete cascade,
  title        text not null,
  description  text,
  content      text,                 -- rich-text / markdown body
  video_url    text,
  document_url text,
  lesson_order int  not null default 0,
  estimated_minutes int,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists training_lessons_course_idx on public.training_lessons (course_id, lesson_order);

-- ---------------------------------------------------------------------------
-- ASSIGNMENTS — a course assigned to a specific user.
-- ---------------------------------------------------------------------------
create table if not exists public.training_assignments (
  id uuid primary key default gen_random_uuid(),
  course_id            uuid not null references public.training_courses(id) on delete cascade,
  assigned_to_user_id  uuid not null references public.users(id) on delete cascade,
  assigned_by_user_id  uuid references public.users(id) on delete set null,
  due_date    date,
  status      training_assignment_status not null default 'NOT_STARTED',
  progress_percentage numeric(5,2) not null default 0,
  completed_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (course_id, assigned_to_user_id)
);
create index if not exists training_assignments_user_idx   on public.training_assignments (assigned_to_user_id);
create index if not exists training_assignments_status_idx on public.training_assignments (status);

-- ---------------------------------------------------------------------------
-- LESSON PROGRESS — one row per (assignment, lesson).
-- ---------------------------------------------------------------------------
create table if not exists public.training_lesson_progress (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.training_assignments(id) on delete cascade,
  lesson_id     uuid not null references public.training_lessons(id)     on delete cascade,
  completed     boolean not null default false,
  completed_at  timestamptz,
  time_spent_minutes int default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (assignment_id, lesson_id)
);
create index if not exists tlp_assignment_idx on public.training_lesson_progress (assignment_id);
create index if not exists tlp_lesson_idx     on public.training_lesson_progress (lesson_id);

-- ---------------------------------------------------------------------------
-- QUIZZES — multiple-choice questions attached to a course.
-- ---------------------------------------------------------------------------
create table if not exists public.training_quizzes (
  id uuid primary key default gen_random_uuid(),
  course_id      uuid not null references public.training_courses(id) on delete cascade,
  question       text not null,
  options        jsonb not null,        -- ["A", "B", "C", "D"]
  correct_answer text not null,         -- the literal correct option
  explanation    text,
  points         int  not null default 1,
  question_order int  not null default 0,
  created_at     timestamptz not null default now()
);
create index if not exists training_quizzes_course_idx on public.training_quizzes (course_id, question_order);

-- ---------------------------------------------------------------------------
-- QUIZ ATTEMPTS — one row per (assignment, quiz) submission.
-- ---------------------------------------------------------------------------
create table if not exists public.training_quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  assignment_id   uuid not null references public.training_assignments(id) on delete cascade,
  quiz_id         uuid not null references public.training_quizzes(id)     on delete cascade,
  selected_answer text not null,
  is_correct      boolean not null,
  score           int    not null default 0,
  attempted_at    timestamptz not null default now()
);
create index if not exists tqa_assignment_idx on public.training_quiz_attempts (assignment_id);
create index if not exists tqa_quiz_idx       on public.training_quiz_attempts (quiz_id);

-- ---------------------------------------------------------------------------
-- ASSIGNMENT UPLOADS — file the consultant submitted for the assignment.
-- ---------------------------------------------------------------------------
create table if not exists public.training_assignment_uploads (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.training_assignments(id) on delete cascade,
  file_url    text not null,
  file_name   text not null,
  mime_type   text,
  size_bytes  bigint,
  uploaded_by uuid references public.users(id) on delete set null,
  uploaded_at timestamptz not null default now()
);
create index if not exists tau_assignment_idx on public.training_assignment_uploads (assignment_id);

-- ---------------------------------------------------------------------------
-- FEEDBACK — manager rates a consultant's assignment.
-- ---------------------------------------------------------------------------
create table if not exists public.training_feedback (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.training_assignments(id) on delete cascade,
  feedback   text not null,
  rating     int check (rating between 1 and 5),
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists training_feedback_assignment_idx on public.training_feedback (assignment_id);

-- ---------------------------------------------------------------------------
-- Seed: a couple of sample DRAFT courses so the UI isn't empty.
-- ---------------------------------------------------------------------------
insert into public.training_courses (title, description, category, difficulty, estimated_duration_hours, tags, status)
values
  ('Spring Boot Foundations',           'Build production REST APIs with Spring Boot — auto-configuration, REST controllers, validation, and JPA.', 'Spring Boot',  'INTERMEDIATE', 6,  array['java','spring','rest'],     'ACTIVE'),
  ('React + TypeScript Crash Course',   'From components and hooks to context, routing, and forms. Pair this with the Resume Building track.',      'React',        'BEGINNER',     5,  array['react','typescript'],       'ACTIVE'),
  ('AWS for Engineers',                 'Core AWS services every engineer should know — EC2, S3, IAM, Lambda, CloudWatch.',                            'AWS',          'INTERMEDIATE', 8,  array['aws','cloud'],              'ACTIVE'),
  ('Interview Prep: System Design',     'Mid + senior system design interviews. Trade-offs, scale, real case studies.',                                 'Interview Preparation', 'ADVANCED', 10, array['system-design','interview'], 'ACTIVE'),
  ('Communication Skills for Consultants','Client conversation playbooks, weekly status updates, and async writing.',                                    'Communication Skills', 'BEGINNER', 3, array['soft-skills'],              'DRAFT')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- updated_at triggers (reuse public.set_updated_at)
-- ---------------------------------------------------------------------------
do $$ declare t text;
begin
  for t in select unnest(array[
    'training_courses','training_lessons','training_assignments','training_lesson_progress'
  ]) loop
    execute format('drop trigger if exists trg_%s_updated_at on public.%s', t, t);
    execute format('create trigger trg_%s_updated_at before update on public.%s
                    for each row execute function public.set_updated_at()', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- RLS — enabled, no policies (service-role key bypasses).
-- ---------------------------------------------------------------------------
alter table public.training_courses             enable row level security;
alter table public.training_lessons             enable row level security;
alter table public.training_assignments         enable row level security;
alter table public.training_lesson_progress     enable row level security;
alter table public.training_quizzes             enable row level security;
alter table public.training_quiz_attempts       enable row level security;
alter table public.training_assignment_uploads  enable row level security;
alter table public.training_feedback            enable row level security;

notify pgrst, 'reload schema';
