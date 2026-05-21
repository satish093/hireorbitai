-- Per-user saved task views for the Tasks workspace. Each row is one named view
-- holding a filter blob (filters_json), a sort key, and the view mode
-- (kanban/table/timeline). Scoped to the owning user; the controller gates by
-- req.user.id. Idempotent.

CREATE TABLE IF NOT EXISTS public.task_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  filters_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_by text,
  view_mode text NOT NULL DEFAULT 'kanban',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS task_views_user_id_idx ON public.task_views (user_id);
