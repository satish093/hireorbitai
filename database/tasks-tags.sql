-- HireOrbit AI — adds tags column to tasks (idempotent)
alter table public.tasks add column if not exists tags text[];
create index if not exists tasks_tags_idx on public.tasks using gin (tags);
