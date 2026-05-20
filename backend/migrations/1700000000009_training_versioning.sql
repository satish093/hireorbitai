-- Course versioning + editorial lifecycle for the Training LMS.
--
-- Problem: training_assignments.course_id is a live FK, so editing a course
-- mutates content for every in-flight student. We add immutable published
-- snapshots (training_course_versions); assignments pin a version; the student
-- player reads the snapshot. Backward compatible — legacy assignments with a
-- NULL course_version_id keep reading the live tables.
--
-- Idempotent: re-running is safe. Mirror of database/training-versioning.sql.

-- ----- Immutable published snapshots -----
CREATE TABLE IF NOT EXISTS public.training_course_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES public.training_courses(id) ON DELETE CASCADE,
  version_number int NOT NULL,
  snapshot jsonb NOT NULL,
  published_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (course_id, version_number)
);
CREATE INDEX IF NOT EXISTS training_course_versions_course_id_idx
  ON public.training_course_versions(course_id);

-- ----- Editorial lifecycle on the course -----
-- review_status is the canonical lifecycle; `status` stays the student-visibility
-- flag (ACTIVE = visible). Publish syncs both.
ALTER TABLE public.training_courses
  ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN IF NOT EXISTS current_version_id uuid REFERENCES public.training_course_versions(id),
  ADD COLUMN IF NOT EXISTS target_audience text;

ALTER TABLE public.training_courses
  DROP CONSTRAINT IF EXISTS training_courses_review_status_chk;
ALTER TABLE public.training_courses
  ADD CONSTRAINT training_courses_review_status_chk
  CHECK (review_status IN ('DRAFT', 'GENERATED', 'REVIEWED', 'PUBLISHED', 'ARCHIVED'));

-- ----- Assignment pins a version + tracks the current lesson -----
ALTER TABLE public.training_assignments
  ADD COLUMN IF NOT EXISTS course_version_id uuid
    REFERENCES public.training_course_versions(id),
  ADD COLUMN IF NOT EXISTS last_viewed_lesson_id uuid;

CREATE INDEX IF NOT EXISTS training_assignments_course_version_id_idx
  ON public.training_assignments(course_version_id);

NOTIFY pgrst, 'reload schema';
