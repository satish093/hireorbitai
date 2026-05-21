-- Activity feed for a task: an append-only log of events (comment, subtask
-- added/completed, etc.). `kind` is the event verb, `payload_json` carries the
-- event-specific data. actor_id nulls out if the user is deleted so history
-- survives. Cascades on task delete. Idempotent.

CREATE TABLE IF NOT EXISTS public.task_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  kind text NOT NULL,
  payload_json jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS task_activity_task_created_idx
  ON public.task_activity (task_id, created_at);
