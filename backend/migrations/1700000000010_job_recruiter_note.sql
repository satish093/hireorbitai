-- Recruiter note on a job — a single pinned, editable note shown in the Job
-- Search detail pane (components/jobs/RecruiterNoteCard). Global per job, not
-- per-user: the most recent editor + timestamp are recorded for attribution.
--
-- Idempotent: re-running is safe. The backend's GET/PATCH /jobs/:id/note
-- handlers degrade gracefully (client falls back to localStorage) until this
-- migration is applied, so the backend can deploy ahead of it.

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS recruiter_note text,
  ADD COLUMN IF NOT EXISTS recruiter_note_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS recruiter_note_at timestamptz;
