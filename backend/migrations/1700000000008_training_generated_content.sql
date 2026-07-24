-- Full-LMS course generation support. Adds structured content + generation
-- status to the Training module so a course can be AI-generated from a title
-- (overview → lessons → per-lesson content → quizzes → exercises → capstone →
-- resources → completion criteria), reviewed/edited, then published.
--
-- Idempotent: every column is `add column if not exists`, every index is
-- `create index if not exists`. Safe to re-run. Uses text + defaults rather
-- than new enum types so re-running never hits the ALTER TYPE-in-transaction
-- pitfall. Mirror of database/training-generated-content.sql.

-- ----- training_courses: structured content + generation lifecycle -----
ALTER TABLE public.training_courses
  ADD COLUMN IF NOT EXISTS content_status text NOT NULL DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS overview text,
  ADD COLUMN IF NOT EXISTS roadmap jsonb,
  ADD COLUMN IF NOT EXISTS resources jsonb,
  ADD COLUMN IF NOT EXISTS capstone jsonb,
  ADD COLUMN IF NOT EXISTS generation_input jsonb;

-- content_status: NONE | GENERATING | OUTLINE_READY | READY | FAILED
ALTER TABLE public.training_courses
  DROP CONSTRAINT IF EXISTS training_courses_content_status_chk;
ALTER TABLE public.training_courses
  ADD CONSTRAINT training_courses_content_status_chk
  CHECK (content_status IN ('NONE', 'GENERATING', 'OUTLINE_READY', 'READY', 'FAILED'));

-- ----- training_lessons: full content payload + per-lesson generation status -----
-- Default 'READY' so existing hand-seeded lessons remain valid (they already
-- have bodies); only AI-stubbed lessons start life as 'PENDING'.
ALTER TABLE public.training_lessons
  ADD COLUMN IF NOT EXISTS content_status text NOT NULL DEFAULT 'READY',
  ADD COLUMN IF NOT EXISTS content_format text NOT NULL DEFAULT 'markdown',
  ADD COLUMN IF NOT EXISTS summary text,
  ADD COLUMN IF NOT EXISTS exercises jsonb,
  ADD COLUMN IF NOT EXISTS key_takeaways jsonb,
  ADD COLUMN IF NOT EXISTS resources jsonb;

-- content_status: PENDING | GENERATING | READY | FAILED
ALTER TABLE public.training_lessons
  DROP CONSTRAINT IF EXISTS training_lessons_content_status_chk;
ALTER TABLE public.training_lessons
  ADD CONSTRAINT training_lessons_content_status_chk
  CHECK (content_status IN ('PENDING', 'GENERATING', 'READY', 'FAILED'));

-- ----- training_quizzes: optional per-lesson scoping (null = course-level) -----
ALTER TABLE public.training_quizzes
  ADD COLUMN IF NOT EXISTS lesson_id uuid
    REFERENCES public.training_lessons(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS training_quizzes_lesson_id_idx
  ON public.training_quizzes(lesson_id);

NOTIFY pgrst, 'reload schema';
