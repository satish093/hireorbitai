-- HireOrbit AI — Database Schema
-- PostgreSQL (self-hosted on the VPS)
-- Run via `psql` against the application database, e.g.
--   psql "$DATABASE_URL" -f database/schema.sql

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- ENUMS
-- ---------------------------------------------------------------------------
do $$ begin
  create type user_role as enum ('SUPER_ADMIN', 'MANAGER', 'RECRUITER', 'CONSULTANT');
exception when duplicate_object then null; end $$;

do $$ begin
  create type invitation_status as enum ('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type consultant_marketing_status as enum ('ACTIVE', 'PAUSED', 'PLACED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type application_status as enum ('SUBMITTED', 'SCREENING', 'INTERVIEW', 'OFFER', 'REJECTED', 'WITHDRAWN');
exception when duplicate_object then null; end $$;

do $$ begin
  create type interview_type as enum ('PHONE', 'TECHNICAL', 'BEHAVIORAL', 'ONSITE', 'FINAL', 'MOCK');
exception when duplicate_object then null; end $$;

do $$ begin
  create type interview_status as enum ('SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW');
exception when duplicate_object then null; end $$;

do $$ begin
  create type reminder_status as enum ('PENDING', 'SENT', 'DONE', 'SNOOZED');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- USERS
-- Canonical user table. Owns the password hash and the session-version
-- counter that lets us revoke all access tokens for a user with one UPDATE.
-- ---------------------------------------------------------------------------
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  password_hash text,
  full_name text,
  phone text,
  role user_role not null default 'CONSULTANT',
  avatar_url text,
  is_active boolean not null default true,
  session_version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.users.password_hash is
  'bcrypt hash of the user''s password. Null only during the brief window between createUser and the welcome email being sent.';
comment on column public.users.session_version is
  'Monotonic counter bumped on global sign-out / password change. JWTs embed the version at issue time; mismatch on /auth/me forces re-login.';

-- ---------------------------------------------------------------------------
-- AUTH SESSIONS
-- Refresh-token store. We keep bcrypt hashes (never the raw secret) so a DB
-- leak doesn''t hand the attacker a usable refresh credential.
-- ---------------------------------------------------------------------------
create table if not exists public.auth_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  refresh_hash text not null,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  user_agent text,
  ip_address text
);
create index if not exists auth_sessions_user_id_idx on public.auth_sessions (user_id);
create index if not exists auth_sessions_expires_idx on public.auth_sessions (expires_at);

-- ---------------------------------------------------------------------------
-- RECRUITERS
-- ---------------------------------------------------------------------------
create table if not exists public.recruiters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique not null references public.users(id) on delete cascade,
  manager_id uuid references public.users(id) on delete set null,
  team text,
  target_submissions_per_week int default 10,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- CONSULTANTS
-- ---------------------------------------------------------------------------
create table if not exists public.consultants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique not null references public.users(id) on delete cascade,
  recruiter_id uuid references public.recruiters(id) on delete set null,
  visa_status text,
  current_location text,
  preferred_locations text[],
  primary_skill text,
  total_experience_years numeric(4,1),
  relocation boolean default false,
  remote_only boolean default false,
  expected_rate numeric(10,2),
  marketing_status consultant_marketing_status not null default 'ACTIVE',
  linkedin_url text,
  github_url text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- INVITATIONS
-- ---------------------------------------------------------------------------
create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  role user_role not null,
  token text unique not null,
  invited_by uuid references public.users(id) on delete set null,
  status invitation_status not null default 'PENDING',
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists invitations_email_idx on public.invitations (email);
create index if not exists invitations_status_idx on public.invitations (status);

-- ---------------------------------------------------------------------------
-- RESUMES — version history per consultant
-- ---------------------------------------------------------------------------
create table if not exists public.resumes (
  id uuid primary key default gen_random_uuid(),
  consultant_id uuid not null references public.consultants(id) on delete cascade,
  version int not null,
  file_name text not null,
  storage_path text not null,           -- storage object path
  mime_type text,
  size_bytes bigint,
  ai_score numeric(5,2),                -- 0-100
  ai_feedback jsonb,
  is_current boolean not null default false,
  uploaded_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (consultant_id, version)
);
create index if not exists resumes_consultant_idx on public.resumes (consultant_id);
create unique index if not exists resumes_one_current_per_consultant
  on public.resumes (consultant_id) where is_current;

-- ---------------------------------------------------------------------------
-- VENDORS
-- ---------------------------------------------------------------------------
create table if not exists public.vendors (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  contact_name text,
  contact_email text,
  contact_phone text,
  website text,
  tier text,                        -- e.g. T1/T2/Prime
  tags text[],
  notes text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists vendors_company_idx on public.vendors (company_name);

-- ---------------------------------------------------------------------------
-- CLIENTS
-- ---------------------------------------------------------------------------
create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  industry text,
  contact_name text,
  contact_email text,
  contact_phone text,
  location text,
  notes text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists clients_company_idx on public.clients (company_name);

-- ---------------------------------------------------------------------------
-- JOBS
-- ---------------------------------------------------------------------------
create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  client_id uuid references public.clients(id) on delete set null,
  vendor_id uuid references public.vendors(id) on delete set null,
  location text,
  remote boolean default false,
  job_type text,                        -- W2/C2C/1099/FTE
  rate_min numeric(10,2),
  rate_max numeric(10,2),
  description text,
  required_skills text[],
  source_url text,
  posted_at timestamptz,
  closes_at timestamptz,
  is_active boolean not null default true,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists jobs_title_idx on public.jobs (title);
create index if not exists jobs_active_idx on public.jobs (is_active);

-- ---------------------------------------------------------------------------
-- APPLICATIONS — consultant ↔ job submissions
-- ---------------------------------------------------------------------------
create table if not exists public.applications (
  id uuid primary key default gen_random_uuid(),
  consultant_id uuid not null references public.consultants(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  resume_id uuid references public.resumes(id) on delete set null,
  vendor_id uuid references public.vendors(id) on delete set null,
  recruiter_id uuid references public.recruiters(id) on delete set null,
  ats_score numeric(5,2),
  ats_feedback jsonb,
  status application_status not null default 'SUBMITTED',
  submitted_at timestamptz not null default now(),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists applications_consultant_idx on public.applications (consultant_id);
create index if not exists applications_job_idx on public.applications (job_id);
-- Duplicate-submission guard: same consultant + same job + same vendor
create unique index if not exists applications_duplicate_guard
  on public.applications (consultant_id, job_id, vendor_id);

-- ---------------------------------------------------------------------------
-- INTERVIEWS
-- ---------------------------------------------------------------------------
create table if not exists public.interviews (
  id uuid primary key default gen_random_uuid(),
  application_id uuid references public.applications(id) on delete cascade,
  consultant_id uuid not null references public.consultants(id) on delete cascade,
  type interview_type not null,
  scheduled_at timestamptz not null,
  duration_minutes int default 60,
  interviewer text,
  meeting_url text,
  status interview_status not null default 'SCHEDULED',
  is_mock boolean not null default false,
  feedback jsonb,                       -- {strengths, weaknesses, rating, notes}
  feedback_submitted_at timestamptz,
  feedback_submitted_by uuid references public.users(id) on delete set null,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists interviews_consultant_idx on public.interviews (consultant_id);
create index if not exists interviews_scheduled_idx on public.interviews (scheduled_at);

-- ---------------------------------------------------------------------------
-- REMINDERS — follow-ups
-- ---------------------------------------------------------------------------
create table if not exists public.reminders (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users(id) on delete cascade,
  title text not null,
  description text,
  related_type text,                    -- 'application' | 'interview' | 'vendor' | ...
  related_id uuid,
  due_at timestamptz not null,
  status reminder_status not null default 'PENDING',
  sent_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists reminders_owner_due_idx on public.reminders (owner_id, due_at);

-- ---------------------------------------------------------------------------
-- RECRUITER DAILY ACTIVITY — denormalized daily report
-- ---------------------------------------------------------------------------
create table if not exists public.recruiter_daily_activity (
  id uuid primary key default gen_random_uuid(),
  recruiter_id uuid not null references public.recruiters(id) on delete cascade,
  activity_date date not null,
  submissions_count int not null default 0,
  interviews_scheduled int not null default 0,
  interviews_completed int not null default 0,
  vendor_calls int not null default 0,
  offers int not null default 0,
  placements int not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  unique (recruiter_id, activity_date)
);
create index if not exists rda_recruiter_date_idx
  on public.recruiter_daily_activity (recruiter_id, activity_date desc);

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

do $$ declare t text;
begin
  for t in select unnest(array[
    'users','recruiters','consultants','vendors','clients','jobs',
    'applications','interviews'
  ]) loop
    execute format('drop trigger if exists trg_%s_updated_at on public.%s', t, t);
    execute format('create trigger trg_%s_updated_at before update on public.%s
                    for each row execute function public.set_updated_at()', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Access control
--
-- The backend is the single client of this database. All authorization
-- happens in the Express layer (middleware/auth.ts + per-route guards), so
-- we deliberately leave RLS disabled — the API enforces who can read what.
--
-- If you ever expose this database directly to a non-server consumer, you
-- MUST re-enable RLS and write role-aware policies before doing so.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- TASKS module (see also database/tasks.sql)
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- ENUMS
-- ---------------------------------------------------------------------------
do $$ begin
  create type task_status as enum
    ('BACKLOG', 'TODO', 'IN_PROGRESS', 'BLOCKED', 'REVIEW', 'COMPLETED', 'CANCELLED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type task_priority as enum ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- TASKS
-- ---------------------------------------------------------------------------
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  status task_status not null default 'BACKLOG',
  priority task_priority not null default 'MEDIUM',
  assignee_id uuid references public.users(id) on delete set null,
  created_by uuid references public.users(id) on delete set null,
  related_consultant_id uuid references public.consultants(id) on delete set null,
  related_recruiter_id uuid references public.recruiters(id) on delete set null,
  due_at timestamptz,
  completed_at timestamptz,
  order_index int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tasks_assignee_idx on public.tasks (assignee_id);
create index if not exists tasks_status_idx on public.tasks (status);
create index if not exists tasks_due_idx on public.tasks (due_at);
create index if not exists tasks_created_by_idx on public.tasks (created_by);

-- ---------------------------------------------------------------------------
-- TASK COMMENTS
-- ---------------------------------------------------------------------------
create table if not exists public.task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  author_id uuid references public.users(id) on delete set null,
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists task_comments_task_idx on public.task_comments (task_id, created_at);

-- ---------------------------------------------------------------------------
-- TASK ATTACHMENTS
-- ---------------------------------------------------------------------------
create table if not exists public.task_attachments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  uploaded_by uuid references public.users(id) on delete set null,
  file_name text not null,
  storage_path text not null,
  mime_type text,
  size_bytes bigint,
  created_at timestamptz not null default now()
);
create index if not exists task_attachments_task_idx on public.task_attachments (task_id);

-- ---------------------------------------------------------------------------
-- updated_at trigger for tasks
-- ---------------------------------------------------------------------------
do $$ begin
  drop trigger if exists trg_tasks_updated_at on public.tasks;
  create trigger trg_tasks_updated_at before update on public.tasks
    for each row execute function public.set_updated_at();
end $$;

-- ---------------------------------------------------------------------------
-- Row Level Security (backend uses service-role key and bypasses these).
-- ---------------------------------------------------------------------------
alter table public.tasks enable row level security;
alter table public.task_comments enable row level security;
alter table public.task_attachments enable row level security;
