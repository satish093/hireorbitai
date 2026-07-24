-- HireOrbit AI — Tasks module migration
-- Adds: tasks, task_comments, task_attachments + enums + RLS.
-- Idempotent: safe to re-run.

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
  tags text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.tasks add column if not exists tags text[];
create index if not exists tasks_assignee_idx on public.tasks (assignee_id);
create index if not exists tasks_status_idx on public.tasks (status);
create index if not exists tasks_due_idx on public.tasks (due_at);
create index if not exists tasks_created_by_idx on public.tasks (created_by);
create index if not exists tasks_tags_idx on public.tasks using gin (tags);

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
