-- =============================================================================
-- Training: full-LMS generated-content support
-- =============================================================================
-- Adds structured content + generation lifecycle to the Training module so a
-- course can be AI-generated from a title and metadata, reviewed/edited, then
-- published. Apply AFTER training.sql, training-completion-gates.sql, and
-- training-i983.sql.
--
-- Idempotent: re-running is safe. This is the manual-baseline mirror of
-- backend/migrations/1700000000008_training_generated_content.sql.
-- =============================================================================

-- ----- training_courses -----
ALTER TABLE public.training_courses
  ADD COLUMN IF NOT EXISTS content_status text NOT NULL DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS overview text,
  ADD COLUMN IF NOT EXISTS roadmap jsonb,
  ADD COLUMN IF NOT EXISTS resources jsonb,
  ADD COLUMN IF NOT EXISTS capstone jsonb,
  ADD COLUMN IF NOT EXISTS generation_input jsonb;

ALTER TABLE public.training_courses
  DROP CONSTRAINT IF EXISTS training_courses_content_status_chk;
ALTER TABLE public.training_courses
  ADD CONSTRAINT training_courses_content_status_chk
  CHECK (content_status IN ('NONE', 'GENERATING', 'OUTLINE_READY', 'READY', 'FAILED'));

-- ----- training_lessons -----
ALTER TABLE public.training_lessons
  ADD COLUMN IF NOT EXISTS content_status text NOT NULL DEFAULT 'READY',
  ADD COLUMN IF NOT EXISTS content_format text NOT NULL DEFAULT 'markdown',
  ADD COLUMN IF NOT EXISTS summary text,
  ADD COLUMN IF NOT EXISTS exercises jsonb,
  ADD COLUMN IF NOT EXISTS key_takeaways jsonb,
  ADD COLUMN IF NOT EXISTS resources jsonb;

ALTER TABLE public.training_lessons
  DROP CONSTRAINT IF EXISTS training_lessons_content_status_chk;
ALTER TABLE public.training_lessons
  ADD CONSTRAINT training_lessons_content_status_chk
  CHECK (content_status IN ('PENDING', 'GENERATING', 'READY', 'FAILED'));

-- ----- training_quizzes -----
ALTER TABLE public.training_quizzes
  ADD COLUMN IF NOT EXISTS lesson_id uuid
    REFERENCES public.training_lessons(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS training_quizzes_lesson_id_idx
  ON public.training_quizzes(lesson_id);

NOTIFY pgrst, 'reload schema';
