-- HireOrbit AI — Training workspace tables (study plans, ratings, activity).
--
-- Backs the redesigned /training learning workspace:
--   training_study_plans       — one AI-generated plan per user (latest = active)
--   training_study_plan_items  — checkable weekly items inside a plan
--   training_course_ratings    — 1–5 star rating per (course, user)
--   training_activity_daily    — per-day study minutes for the 14-day heatmap
--
-- Idempotent: create-if-not-exists + add-column-if-not-exists. Safe to re-run.

-- ── Study plans ─────────────────────────────────────────────────────────────
create table if not exists public.training_study_plans (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  title       text not null,
  rationale   text,                                  -- "why this plan"
  status      text not null default 'active',        -- active | archived
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists training_study_plans_user_idx
  on public.training_study_plans (user_id, status, created_at desc);

create table if not exists public.training_study_plan_items (
  id           uuid primary key default gen_random_uuid(),
  plan_id      uuid not null references public.training_study_plans(id) on delete cascade,
  week_no      int  not null default 1,
  week_label   text,                                 -- "Week 1"
  focus_area   text,                                 -- "Foundations"
  title        text not null,
  item_type    text not null default 'Lesson',       -- Course | Lesson | Quiz | Read | Live
  duration_min int,
  course_id    uuid references public.training_courses(id) on delete set null,
  sort_order   int  not null default 0,
  completed    boolean not null default false,
  completed_at timestamptz
);
create index if not exists training_study_plan_items_plan_idx
  on public.training_study_plan_items (plan_id, week_no, sort_order);

-- ── Course ratings ──────────────────────────────────────────────────────────
create table if not exists public.training_course_ratings (
  id         uuid primary key default gen_random_uuid(),
  course_id  uuid not null references public.training_courses(id) on delete cascade,
  user_id    uuid not null references public.users(id) on delete cascade,
  rating     int  not null check (rating between 1 and 5),
  created_at timestamptz not null default now(),
  unique (course_id, user_id)
);
create index if not exists training_course_ratings_course_idx
  on public.training_course_ratings (course_id);

-- ── Daily study activity (heatmap) ──────────────────────────────────────────
create table if not exists public.training_activity_daily (
  user_id       uuid not null references public.users(id) on delete cascade,
  activity_date date not null,
  minutes       int  not null default 0,
  primary key (user_id, activity_date)
);
