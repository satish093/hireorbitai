-- Per-recruiter weekly targets for the dashboard WeeklyGoals card. One row per
-- (recruiter, goal_type); the app seeds sensible defaults when no row exists so
-- the backend can deploy ahead of this migration (GET returns defaults, the
-- card keeps working). Idempotent.

CREATE TABLE IF NOT EXISTS public.recruiter_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recruiter_id uuid NOT NULL REFERENCES public.recruiters(id) ON DELETE CASCADE,
  goal_type text NOT NULL,
  target integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS recruiter_goals_unique_idx
  ON public.recruiter_goals (recruiter_id, goal_type);
