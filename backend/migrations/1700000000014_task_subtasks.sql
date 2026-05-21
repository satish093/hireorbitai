-- Subtasks (checklist items) for a task. Ordered by order_idx for manual
-- reordering on the task detail panel. Cascades on task delete. Idempotent.

CREATE TABLE IF NOT EXISTS public.task_subtasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  label text NOT NULL,
  done boolean NOT NULL DEFAULT false,
  order_idx int NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS task_subtasks_task_id_idx ON public.task_subtasks (task_id);
