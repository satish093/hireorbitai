import { RequestHandler } from 'express';
import { z } from 'zod';
import * as repo from '../repositories/training.repository';
import * as svc from '../services/training.service';
import * as ai from '../services/trainingAI.service';
import { httpError, MANAGER_TIER } from '../types';
import { logger } from '../config/logger';
import { evaluateAchievements, logStudyMinutes } from '../services/trainingAchievements.service';

function isManagerTier(role?: string): boolean {
  return !!role && (MANAGER_TIER as string[]).includes(role);
}

// ---------------------------------------------------------------------------
// COURSES
// ---------------------------------------------------------------------------
export const listCourses: RequestHandler = async (req, res) => {
  const { status, category } = req.query as Record<string, string | undefined>;
  const { data, error } = await repo.courses.list({ status, category });
  if (error) throw httpError(500, error.message);
  res.json(data ?? []);
};

export const getCourse: RequestHandler = async (req, res) => {
  const { data, error } = await repo.courses.get(req.params.id);
  if (error || !data) throw httpError(404, 'Course not found');
  // Answer-key guard. This route has no role gate (the student catalog reads
  // it too), and repo.courses.get embeds the raw training_quizzes rows incl.
  // correct_answer/explanation. Managers/admins author courses and need the
  // key to edit; everyone else (students) must not see it or they can defeat
  // the quiz completion gate. Mirrors svc.stripQuizAnswers (fail-closed: an
  // unknown role is treated as a student).
  if (!isManagerTier(req.user?.role)) {
    const d = data as { quizzes?: unknown[] };
    if (Array.isArray(d.quizzes)) {
      d.quizzes = d.quizzes.map((q) => {
        const {
          correct_answer: _c,
          explanation: _e,
          ...rest
        } = (q ?? {}) as Record<string, unknown>;
        return rest;
      });
    }
  }
  res.json(data);
};

const COMPLIANCE_CATEGORIES = [
  'Technical Training',
  'Client Project Preparation',
  'Tool Training',
  'Domain Training',
  'Communication Training',
  'Security Training',
  'Process Training',
] as const;

const courseSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().nullable().optional(),
  category: z.string().min(1).max(80),
  thumbnail_url: z.string().url().nullable().optional(),
  difficulty: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED']).default('BEGINNER'),
  estimated_duration_hours: z.number().nullable().optional(),
  tags: z.array(z.string()).default([]),
  status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']).default('DRAFT'),
  // I-983 Section 6 metadata — what's being taught, how it's assessed,
  // how it ties to the student's STEM degree, weekly training cadence.
  learning_objectives: z.array(z.string()).nullable().optional(),
  skills_taught: z.array(z.string()).nullable().optional(),
  assessment_methods: z.array(z.string()).nullable().optional(),
  stem_relevance: z.string().nullable().optional(),
  weekly_hours: z.number().nullable().optional(),
  // Completion gates (STEM OPT compliance spec).
  compliance_category: z.enum(COMPLIANCE_CATEGORIES).nullable().optional(),
  minimum_time_minutes: z.number().int().min(0).nullable().optional(),
  required_completion_score: z.number().min(0).max(100).nullable().optional(),
  quiz_passing_score: z.number().min(0).max(100).nullable().optional(),
  quiz_max_attempts: z.number().int().min(1).nullable().optional(),
  requires_manager_approval: z.boolean().optional(),
  trainer_user_id: z.string().uuid().nullable().optional(),
  expected_outcomes: z.array(z.string()).nullable().optional(),
  related_job_duties: z.array(z.string()).nullable().optional(),
  // Generated-content fields (editable after AI generation).
  overview: z.string().nullable().optional(),
  roadmap: z.any().optional(),
  resources: z.any().optional(),
  capstone: z.any().optional(),
  target_audience: z.string().max(500).nullable().optional(),
});

export const createCourse: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const parsed = courseSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());
  const { data, error } = await repo.courses.create({ ...parsed.data, created_by: req.user.id });
  if (error) throw httpError(500, error.message);
  res.status(201).json(data);
};

export const updateCourse: RequestHandler = async (req, res) => {
  const parsed = courseSchema.partial().safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());
  // Keep the editorial lifecycle in sync with a direct status edit (the manual
  // flow flips status via this endpoint) so review_status can't drift — e.g.
  // archiving must not leave a course marked PUBLISHED.
  const patch: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.status) {
    patch.review_status =
      parsed.data.status === 'ACTIVE'
        ? 'PUBLISHED'
        : parsed.data.status === 'ARCHIVED'
          ? 'ARCHIVED'
          : 'DRAFT';
  }
  const { data, error } = await repo.courses.update(req.params.id, patch);
  if (error) throw httpError(500, error.message);
  res.json(data);
};

export const deleteCourse: RequestHandler = async (req, res) => {
  const { error } = await repo.courses.remove(req.params.id);
  if (error) throw httpError(500, error.message);
  res.json({ ok: true });
};

// ---------------------------------------------------------------------------
// LESSONS
// ---------------------------------------------------------------------------
const lessonSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().nullable().optional(),
  content: z.string().nullable().optional(),
  video_url: z.string().url().nullable().optional(),
  document_url: z.string().url().nullable().optional(),
  lesson_order: z.number().int().default(0),
  estimated_minutes: z.number().int().nullable().optional(),
  // Per-lesson gates (STEM OPT compliance spec).
  lesson_objective: z.string().nullable().optional(),
  practical_example: z.string().nullable().optional(),
  knowledge_check_required: z.boolean().optional(),
  minimum_time_minutes: z.number().int().min(0).nullable().optional(),
  // Generated-content fields (editable after AI generation).
  summary: z.string().nullable().optional(),
  exercises: z.any().optional(),
  key_takeaways: z.any().optional(),
  content_status: z.enum(['PENDING', 'GENERATING', 'READY', 'FAILED']).optional(),
});

export const createLesson: RequestHandler = async (req, res) => {
  const parsed = lessonSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());
  const { data, error } = await repo.lessons.create({ ...parsed.data, course_id: req.params.id });
  if (error) throw httpError(500, error.message);
  res.status(201).json(data);
};

export const updateLesson: RequestHandler = async (req, res) => {
  const parsed = lessonSchema.partial().safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());
  const patch = { ...parsed.data };
  // exercises and key_takeaways are JSONB — serialize arrays before the update
  if (patch.exercises !== undefined && patch.exercises !== null) {
    patch.exercises = JSON.stringify(patch.exercises);
  }
  if (patch.key_takeaways !== undefined && patch.key_takeaways !== null) {
    patch.key_takeaways = JSON.stringify(patch.key_takeaways);
  }
  const { data, error } = await repo.lessons.update(req.params.id, patch);
  if (error) throw httpError(500, error.message);
  res.json(data);
};

export const deleteLesson: RequestHandler = async (req, res) => {
  const { error } = await repo.lessons.remove(req.params.id);
  if (error) throw httpError(500, error.message);
  res.json({ ok: true });
};

// ---------------------------------------------------------------------------
// ASSIGNMENTS
// ---------------------------------------------------------------------------
const assignSchema = z.object({
  course_id: z.string().uuid(),
  user_ids: z.array(z.string().uuid()).min(1),
  due_date: z.string().nullable().optional(),
});

export const assign: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const parsed = assignSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());
  const result = await svc.bulkAssignCourse({
    course_id: parsed.data.course_id,
    user_ids: parsed.data.user_ids,
    assigned_by_user_id: req.user.id,
    due_date: parsed.data.due_date ?? null,
  });
  res.status(201).json(result);
};

export const listAssignments: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  await svc.flagOverdue(); // cheap pass to stamp OVERDUE rows
  const { status, user_id } = req.query as Record<string, string | undefined>;
  const { data, error } = await repo.assignments.list({
    status,
    assigned_to_user_id: user_id,
  });
  if (error) throw httpError(500, error.message);
  res.json(data ?? []);
};

export const myTraining: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  await svc.flagOverdue();
  const { data, error } = await repo.assignments.listForUser(req.user.id);
  if (error) throw httpError(500, error.message);
  res.json(data ?? []);
};

export const getAssignment: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const { data: row, error } = await repo.assignments.get(req.params.id);
  if (error || !row) throw httpError(404, 'Assignment not found');
  const a: any = row;
  // Auth: consultants/recruiters can only see their own; manager-tier sees all.
  if (!isManagerTier(req.user.role) && a.assigned_to_user_id !== req.user.id) {
    throw httpError(404, 'Not found');
  }
  // Hydrate lesson progress + uploads + feedback + quiz attempts for the
  // assignment-detail view in one round-trip.
  const [pr, up, fb, qa, content] = await Promise.all([
    repo.progress.listForAssignment(a.id),
    repo.uploads.listForAssignment(a.id),
    repo.feedback.listForAssignment(a.id),
    repo.quizAttempts.listForAssignment(a.id),
    svc.resolveAssignmentContent(a),
  ]);
  res.json({
    ...a,
    lesson_progress: pr.data ?? [],
    uploads: up.data ?? [],
    feedback: fb.data ?? [],
    quiz_attempts: qa.data ?? [],
    // Pinned-version (or live, for legacy) course content the player should
    // render — answer keys stripped so quizzes stay un-cheatable until submit.
    course_content: svc.stripQuizAnswers(content),
  });
};

// I-983 attestation block lives on the assignment row (one row per
// training engagement). Manager-tier patches this when authoring the plan.
const assignmentI983Schema = z.object({
  employer_name: z.string().nullable().optional(),
  employer_address: z.string().nullable().optional(),
  employer_ein: z.string().nullable().optional(),
  employer_everify_no: z.string().nullable().optional(),
  supervisor_name: z.string().nullable().optional(),
  supervisor_title: z.string().nullable().optional(),
  supervisor_email: z.string().email().nullable().optional().or(z.literal('')),
  oversight_method: z.string().nullable().optional(),
  wage_amount: z.number().nullable().optional(),
  wage_basis: z.enum(['HOURLY', 'SALARY']).nullable().optional(),
  weekly_hours: z.number().nullable().optional(),
  stem_degree: z.string().nullable().optional(),
  stem_cip_code: z.string().nullable().optional(),
  training_start_date: z.string().nullable().optional(),
  training_end_date: z.string().nullable().optional(),
  due_date: z.string().nullable().optional(),
});

export const updateAssignment: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  if (!isManagerTier(req.user.role)) throw httpError(403, 'Manager-tier only');
  const parsed = assignmentI983Schema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());
  // Strip empty-string emails so we don't store them.
  const patch: any = { ...parsed.data };
  if (patch.supervisor_email === '') patch.supervisor_email = null;
  const { data, error } = await repo.assignments.update(req.params.id, patch);
  if (error) throw httpError(500, error.message);
  res.json(data);
};

const progressSchema = z.object({
  lesson_id: z.string().uuid(),
  completed: z.boolean(),
  time_spent_minutes: z.number().int().nullable().optional(),
});

export const updateProgress: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const parsed = progressSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());

  // Caller must own the assignment OR be manager-tier.
  const { data: a } = await repo.assignments.get(req.params.id);
  if (!a) throw httpError(404, 'Assignment not found');
  if ((a as any).assigned_to_user_id !== req.user.id && !isManagerTier(req.user.role)) {
    throw httpError(404, 'Not found');
  }

  await svc.markLessonProgress({
    assignment_id: req.params.id,
    lesson_id: parsed.data.lesson_id,
    completed: parsed.data.completed,
    time_spent_minutes: parsed.data.time_spent_minutes ?? undefined,
  });
  // Workspace side-effects: credit study time + re-evaluate achievements for
  // the assignment owner. Best-effort — never blocks the progress response.
  const owner = (a as { assigned_to_user_id: string }).assigned_to_user_id;
  void logStudyMinutes(owner, parsed.data.time_spent_minutes ?? 0);
  void evaluateAchievements(owner);
  const fresh = await repo.assignments.get(req.params.id);
  res.json(fresh.data);
};

// ---------------------------------------------------------------------------
// UPLOADS — records the file URL; the file itself rides on local filesystem storage.
// ---------------------------------------------------------------------------
const uploadSchema = z.object({
  file_url: z.string().url(),
  file_name: z.string().min(1),
  mime_type: z.string().nullable().optional(),
  size_bytes: z.number().int().nullable().optional(),
});
export const recordUpload: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  // Caller must own this assignment (or be manager-tier). Without this, any
  // signed-in user could plant compliance-evidence rows on another user's
  // assignment — those rows surface in the manager-facing CSV and feed the
  // upload-gate completion check.
  await assertCanReadAssignment(req, req.params.id);
  const parsed = uploadSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());
  const { data, error } = await repo.uploads.create({
    ...parsed.data,
    assignment_id: req.params.id,
    uploaded_by: req.user.id,
  });
  if (error) throw httpError(500, error.message);
  res.status(201).json(data);
};

// ---------------------------------------------------------------------------
// FEEDBACK
// ---------------------------------------------------------------------------
const feedbackSchema = z.object({
  feedback: z.string().min(1).max(4000),
  rating: z.number().int().min(1).max(5).nullable().optional(),
});
export const addFeedback: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  if (!isManagerTier(req.user.role)) throw httpError(403, 'Manager-tier only');
  const parsed = feedbackSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());
  const { data, error } = await repo.feedback.create({
    ...parsed.data,
    assignment_id: req.params.id,
    created_by: req.user.id,
  });
  if (error) throw httpError(500, error.message);
  res.status(201).json(data);
};

// ---------------------------------------------------------------------------
// QUIZ — list + record attempt
// ---------------------------------------------------------------------------
// Answer-stripped by default — never ship correct_answer/explanation to a
// student before they submit. Managers read the answer key via the course
// detail embed (manager-only route).
export const listQuiz: RequestHandler = async (req, res) => {
  const { data, error } = await repo.quizzes.listByCourse(req.params.id);
  if (error) throw httpError(500, error.message);
  res.json(data ?? []);
};

// GET /lessons/:id/quiz — per-lesson knowledge check, answer-stripped.
export const listLessonQuiz: RequestHandler = async (req, res) => {
  const { data, error } = await repo.quizzes.listByLesson(req.params.id);
  if (error) throw httpError(500, error.message);
  res.json(data ?? []);
};

// ---- Manual quiz-question CRUD (manager-tier) for the inline editor ----
const quizQuestionSchema = z
  .object({
    question: z.string().min(1).max(2000),
    options: z.array(z.string().min(1)).min(2).max(6),
    correct_answer: z.string().min(1),
    explanation: z.string().max(2000).nullable().optional(),
    points: z.number().int().min(1).max(10).default(1),
    question_order: z.number().int().min(0).optional(),
  })
  .strict();

export const createLessonQuizQuestion: RequestHandler = async (req, res) => {
  const parsed = quizQuestionSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());
  const { data: lesson, error: lErr } = await repo.lessons.get(req.params.id);
  if (lErr || !lesson) throw httpError(404, 'Lesson not found');
  // correct_answer must be one of the options.
  if (!parsed.data.options.includes(parsed.data.correct_answer)) {
    throw httpError(400, 'correct_answer must match one of the options');
  }
  const { data, error } = await repo.quizzes.create({
    ...parsed.data,
    lesson_id: req.params.id,
    course_id: (lesson as any).course_id,
  });
  if (error) throw httpError(500, error.message);
  res.status(201).json(data);
};

export const updateQuizQuestion: RequestHandler = async (req, res) => {
  const parsed = quizQuestionSchema.partial().safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());
  if (
    parsed.data.options &&
    parsed.data.correct_answer &&
    !parsed.data.options.includes(parsed.data.correct_answer)
  ) {
    throw httpError(400, 'correct_answer must match one of the options');
  }
  const { data, error } = await repo.quizzes.update(req.params.id, parsed.data);
  if (error) throw httpError(500, error.message);
  res.json(data);
};

export const deleteQuizQuestion: RequestHandler = async (req, res) => {
  const { error } = await repo.quizzes.remove(req.params.id);
  if (error) throw httpError(500, error.message);
  res.json({ ok: true });
};

// PUT /assignments/:id/viewed — record the student's current lesson (resume +
// "current lesson" analytics). Owner-or-manager only.
const viewedSchema = z.object({ lesson_id: z.string().uuid() }).strict();
export const markLessonViewed: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const parsed = viewedSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());
  const { data: a } = await repo.assignments.get(req.params.id);
  if (!a) throw httpError(404, 'Not found');
  if ((a as any).assigned_to_user_id !== req.user.id && !isManagerTier(req.user.role)) {
    throw httpError(404, 'Not found');
  }
  await repo.assignments.update(req.params.id, { last_viewed_lesson_id: parsed.data.lesson_id });
  res.json({ ok: true });
};

const quizAttemptSchema = z.object({
  quiz_id: z.string().uuid(),
  selected_answer: z.string(),
  // Spec also wants the full jsonb envelope (e.g. multi-select / matrix
  // questions in the future). Keep optional + store as-is.
  selected_answers: z.any().optional(),
});
export const submitQuizAttempt: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const parsed = quizAttemptSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());

  // Caller must own the assignment OR be manager-tier.
  const { data: a } = await repo.assignments.get(req.params.id);
  if (!a) throw httpError(404, 'Assignment not found');
  if ((a as any).assigned_to_user_id !== req.user.id && !isManagerTier(req.user.role)) {
    throw httpError(404, 'Not found');
  }

  // Grade against the pinned version's answer key (the live quiz may have
  // changed or been deleted since this student was assigned).
  const quiz = await svc.getAssignmentQuiz(a, parsed.data.quiz_id);
  if (!quiz) throw httpError(404, 'Quiz not found');

  const isCorrect = parsed.data.selected_answer === (quiz as any).correct_answer;
  const score = isCorrect ? Number((quiz as any).points ?? 1) : 0;

  const saved = await svc.recordQuizAttempt({
    assignment_id: req.params.id,
    quiz_id: parsed.data.quiz_id,
    selected_answer: parsed.data.selected_answer,
    selected_answers: parsed.data.selected_answers,
    is_correct: isCorrect,
    score,
  });
  void evaluateAchievements((a as { assigned_to_user_id: string }).assigned_to_user_id);
  res.status(201).json({
    ...saved,
    correct_answer: (quiz as any).correct_answer,
    explanation: (quiz as any).explanation,
  });
};

// ---------------------------------------------------------------------------
// REPORTS
// ---------------------------------------------------------------------------
export const reports: RequestHandler = async (_req, res) => {
  res.json(await svc.reports());
};

// ---------------------------------------------------------------------------
// AI endpoints
// ---------------------------------------------------------------------------
export const aiGeneratePlan: RequestHandler = async (req, res) => {
  const schema = z.object({ resume_text: z.string().min(50), job_description: z.string().min(20) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());
  try {
    res.json(await ai.generateTrainingPlan(parsed.data));
  } catch (e: any) {
    throw httpError(e?.status ?? 502, e?.message ?? 'Training plan generation failed');
  }
};

export const aiInterviewQuestions: RequestHandler = async (req, res) => {
  const schema = z.object({
    job_description: z.string().min(20),
    skills: z.array(z.string()).default([]),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());
  try {
    res.json(await ai.generateInterviewQuestions(parsed.data));
  } catch (e: any) {
    throw httpError(e?.status ?? 502, e?.message ?? 'Interview question generation failed');
  }
};

export const aiGenerateQuiz: RequestHandler = async (req, res) => {
  const schema = z.object({
    lesson_content: z.string().min(50),
    count: z.number().int().min(3).max(15).optional(),
    /** Optional: when supplied, the generated questions are persisted on the course. */
    course_id: z.string().uuid().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());

  let out: Awaited<ReturnType<typeof ai.generateQuiz>>;
  try {
    out = await ai.generateQuiz({
      lesson_content: parsed.data.lesson_content,
      count: parsed.data.count,
    });
  } catch (e: any) {
    throw httpError(e?.status ?? 502, e?.message ?? 'Quiz generation failed');
  }

  if (parsed.data.course_id) {
    const rows = out.questions.map((q, i) => ({
      course_id: parsed.data.course_id,
      question: q.question,
      options: q.options,
      correct_answer: q.correct_answer,
      explanation: q.explanation,
      points: q.points ?? 1,
      question_order: i,
    }));
    // Non-fatal — return the generated questions even if persistence fails.
    await repo.quizzes
      .createMany(rows)
      .catch((e) => logger.warn({ err: e }, 'quiz persistence failed after generation'));
  }
  res.json(out);
};

// ---------------------------------------------------------------------------
// FULL-COURSE GENERATION (LMS authoring)
//   1. generateCourse        — title+metadata → DRAFT course + lesson stubs
//   2. generateOutline       — (re)generate outline for an existing course
//   3. generateLessonContent — fill one lesson body + exercises + quiz
//   4. generateCapstone      — course-level final-assessment template
//   5. publishCourse         — guarded DRAFT → ACTIVE (all lessons READY)
// All manager-tier. Generation is progressive: the client drives the
// per-lesson loop so each AI call stays bounded.
// ---------------------------------------------------------------------------
const DIFFICULTY = z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED']);

const generateCourseSchema = z
  .object({
    title: z.string().min(1).max(200),
    category: z.string().min(1).max(80),
    difficulty: DIFFICULTY.default('BEGINNER'),
    estimated_duration_hours: z.number().min(0).nullable().optional(),
    tags: z.array(z.string()).default([]),
    lesson_count: z.number().int().min(3).max(20).nullable().optional(),
    target_audience: z.string().max(500).nullable().optional(),
  })
  .strict();

/** Persist an outline onto a course row + (re)create its lesson stubs. */
async function applyOutline(
  courseId: string,
  outline: import('../services/trainingAI.service').CourseOutline,
  degraded: boolean,
) {
  const cc = outline.completion_criteria;
  await repo.courses.update(courseId, {
    overview: outline.overview,
    description: outline.overview.slice(0, 500),
    learning_objectives: outline.learning_objectives,
    skills_taught: outline.skills_taught,
    expected_outcomes: outline.expected_outcomes,
    roadmap: outline.roadmap,
    resources: outline.resources,
    estimated_duration_hours: outline.estimated_duration_hours,
    minimum_time_minutes: cc.minimum_time_minutes,
    quiz_passing_score: cc.quiz_passing_score,
    quiz_max_attempts: cc.quiz_max_attempts,
    requires_manager_approval: cc.requires_manager_approval,
    content_status: degraded ? 'FAILED' : 'OUTLINE_READY',
    review_status: degraded ? 'DRAFT' : 'GENERATED',
  });
  const lessonRows = outline.lessons.map((l) => ({
    course_id: courseId,
    title: l.title,
    summary: l.summary,
    lesson_objective: l.objective,
    estimated_minutes: l.estimated_minutes,
    lesson_order: l.lesson_order,
    content_status: 'PENDING',
  }));
  const { data: lessons, error } = await repo.lessons.createMany(lessonRows);
  if (error) throw httpError(500, error.message);
  return lessons ?? [];
}

export const generateCourse: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const parsed = generateCourseSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());

  // Create the shell first so a slow/failed generation still leaves an
  // editable DRAFT behind.
  const { data: course, error } = await repo.courses.create({
    title: parsed.data.title,
    category: parsed.data.category,
    difficulty: parsed.data.difficulty,
    estimated_duration_hours: parsed.data.estimated_duration_hours ?? null,
    tags: parsed.data.tags,
    target_audience: parsed.data.target_audience ?? null,
    status: 'DRAFT',
    content_status: 'GENERATING',
    created_by: req.user.id,
    generation_input: parsed.data,
  });
  if (error || !course) throw httpError(500, error?.message ?? 'Failed to create course');
  const courseId = (course as any).id as string;

  const { data: outline, degraded } = await ai.generateCourseOutline({
    title: parsed.data.title,
    category: parsed.data.category,
    difficulty: parsed.data.difficulty,
    estimated_duration_hours: parsed.data.estimated_duration_hours ?? undefined,
    tags: parsed.data.tags,
    lesson_count: parsed.data.lesson_count ?? undefined,
    target_audience: parsed.data.target_audience ?? undefined,
  });
  const lessons = await applyOutline(courseId, outline, degraded);

  res.status(201).json({
    course_id: courseId,
    content_status: degraded ? 'FAILED' : 'OUTLINE_READY',
    degraded,
    lessons: (lessons as any[]).map((l) => ({
      id: l.id,
      title: l.title,
      content_status: l.content_status,
    })),
  });
};

const generateOutlineSchema = z
  .object({
    lesson_count: z.number().int().min(3).max(20).nullable().optional(),
    replace: z.boolean().optional(),
  })
  .strict();

export const generateOutline: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const parsed = generateOutlineSchema.safeParse(req.body ?? {});
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());

  const { data: course, error } = await repo.courses.get(req.params.id);
  if (error || !course) throw httpError(404, 'Course not found');
  const c: any = course;
  const existingLessons = (c.lessons ?? []) as any[];
  if (existingLessons.length > 0 && !parsed.data.replace) {
    throw httpError(409, 'Course already has lessons; pass replace=true to regenerate');
  }
  // Replacing: drop existing lessons (cascades their progress/quizzes).
  for (const l of existingLessons) await repo.lessons.remove(l.id);

  await repo.courses.update(req.params.id, { content_status: 'GENERATING' });
  const { data: outline, degraded } = await ai.generateCourseOutline({
    title: c.title,
    category: c.category,
    difficulty: c.difficulty,
    estimated_duration_hours: c.estimated_duration_hours ?? undefined,
    tags: c.tags ?? [],
    lesson_count: parsed.data.lesson_count ?? undefined,
  });
  const lessons = await applyOutline(req.params.id, outline, degraded);
  res.json({
    course_id: req.params.id,
    content_status: degraded ? 'FAILED' : 'OUTLINE_READY',
    degraded,
    lessons: (lessons as any[]).map((l) => ({
      id: l.id,
      title: l.title,
      content_status: l.content_status,
    })),
  });
};

export const generateLessonContent: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const { data: lesson, error } = await repo.lessons.get(req.params.id);
  if (error || !lesson) throw httpError(404, 'Lesson not found');
  const l: any = lesson;
  const { data: course } = await repo.courses.get(l.course_id);
  const c: any = course ?? {};

  // Build the Anthropic client for this request with the following priority:
  //   1. aiToken from body (admin pasted their own key in the modal — explicit override)
  //   2. ANTHROPIC_OAUTH_TOKEN (admin's Claude Max subscription) — admin-tier only
  //   3. Fall through to the global client (ANTHROPIC_API_KEY or configured provider)
  const { aiToken } = req.body as { aiToken?: unknown };
  const AnthropicSDK = (await import('@anthropic-ai/sdk')).default;
  let customClient: InstanceType<typeof AnthropicSDK> | undefined;

  if (typeof aiToken === 'string' && aiToken.length > 10) {
    // Explicit key from the modal
    const isOAuth = !aiToken.startsWith('sk-');
    customClient = new AnthropicSDK(
      isOAuth ? { authToken: aiToken, maxRetries: 0 } : { apiKey: aiToken, maxRetries: 0 },
    );
  } else {
    // Auto-select: subscription token for admins if configured on the server
    const oauthToken = process.env.ANTHROPIC_OAUTH_TOKEN ?? '';
    if (oauthToken.length > 10) {
      customClient = new AnthropicSDK({ authToken: oauthToken, maxRetries: 0 });
    }
    // else: fall through to global client (API key path)
  }

  await repo.lessons.update(l.id, { content_status: 'GENERATING' });

  let content: ai.LessonContent;
  try {
    const result = await ai.generateLessonContent(
      {
        course_title: c.title ?? l.title,
        category: c.category ?? 'General',
        difficulty: c.difficulty ?? 'BEGINNER',
        lesson_title: l.title,
        lesson_summary: l.summary,
        lesson_objective: l.lesson_objective,
      },
      { strict: true, client: customClient },
    );
    content = result.data;
  } catch (err: any) {
    await repo.lessons.update(l.id, { content_status: 'FAILED' });
    const status = err?.status === 503 ? 503 : 502;
    throw httpError(
      status,
      err?.message ?? 'AI generation failed — check ANTHROPIC_API_KEY and try again.',
    );
  }

  // exercises and key_takeaways are JSONB columns — pg passes JS arrays as
  // PostgreSQL array literals which JSONB rejects; serialise to JSON strings first.
  const { data: updated, error: upErr } = await repo.lessons.update(l.id, {
    content: content.content,
    content_format: 'markdown',
    practical_example: content.practical_example,
    exercises: content.exercises != null ? JSON.stringify(content.exercises) : null,
    key_takeaways: JSON.stringify(content.key_takeaways),
    content_status: 'READY',
  });
  if (upErr) throw httpError(500, upErr.message);

  await repo.quizzes.removeForLesson(l.id);
  if (content.quiz && content.quiz.length > 0) {
    await repo.quizzes.createMany(
      content.quiz.map((q, i) => ({
        course_id: l.course_id,
        lesson_id: l.id,
        question: q.question,
        options: q.options,
        correct_answer: q.correct_answer,
        explanation: q.explanation,
        points: q.points ?? 1,
        question_order: i,
      })),
    );
  }
  res.json({ ...(updated as any), degraded: false });
};

// Non-destructive AI enrich: structure only, lessons untouched (admin-tier).
export const enrichCourse: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const { degraded } = await svc.enrichCourse(req.params.id);
  const { data } = await repo.courses.get(req.params.id);
  res.json({ degraded, course: data });
};

// Backfill every course missing structured content (admin-tier).
export const backfillCourses: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const results = await svc.backfillCourses();
  res.json({ results });
};

export const generateCapstone: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const { data: course, error } = await repo.courses.get(req.params.id);
  if (error || !course) throw httpError(404, 'Course not found');
  const c: any = course;
  const { data: capstone, degraded } = await ai.generateCapstone({
    course_title: c.title,
    category: c.category,
    difficulty: c.difficulty,
    learning_objectives: c.learning_objectives ?? [],
  });
  const { data, error: upErr } = await repo.courses.update(req.params.id, { capstone });
  if (upErr) throw httpError(500, upErr.message);
  res.json({ capstone, degraded, course: data });
};

export const publishCourse: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const { data: course, error } = await repo.courses.get(req.params.id);
  if (error || !course) throw httpError(404, 'Course not found');
  const lessons = ((course as any).lessons ?? []) as any[];
  if (lessons.length === 0) throw httpError(409, 'Cannot publish a course with no lessons');
  const notReady = lessons.filter((l) => (l.content_status ?? 'READY') !== 'READY');
  if (notReady.length > 0) {
    throw httpError(409, `${notReady.length} lesson(s) still need content before publishing`);
  }
  // Freeze an immutable version + flip to PUBLISHED/ACTIVE pointing at it.
  const result = await svc.publishCourse(req.params.id, req.user.id);
  res.json(result);
};

// Set the editorial review state (manager-tier). Lets a human sign off on
// generated content before publishing.
export const reviewCourse: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const { data: course, error } = await repo.courses.get(req.params.id);
  if (error || !course) throw httpError(404, 'Course not found');
  const { data, error: upErr } = await repo.courses.update(req.params.id, {
    review_status: 'REVIEWED',
  });
  if (upErr) throw httpError(500, upErr.message);
  res.json(data);
};

// ---------------------------------------------------------------------------
// I-983 EVALUATIONS — 12-month self + final, plus optional supervisor interim.
// Authorization:
//   - Manager-tier can create/update any evaluation on any assignment.
//   - The assigned consultant can create/update their own SELF_12_MONTH and
//     FINAL evaluations (student-signed portions).
// ---------------------------------------------------------------------------
const evalSchema = z.object({
  kind: z.enum(['SELF_12_MONTH', 'FINAL', 'SUPERVISOR_INTERIM']),
  evaluation_date: z.string().optional(),
  goals_progress: z.string().nullable().optional(),
  skills_acquired: z.string().nullable().optional(),
  hours_completed: z.number().nullable().optional(),
  supervisor_notes: z.string().nullable().optional(),
  rating: z.number().int().min(1).max(5).nullable().optional(),
  student_signature_name: z.string().nullable().optional(),
  student_signed_at: z.string().nullable().optional(),
  supervisor_signature_name: z.string().nullable().optional(),
  supervisor_signed_at: z.string().nullable().optional(),
});

async function assertCanWriteEval(req: any, assignmentId: string, kind?: string) {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const { data: a } = await repo.assignments.get(assignmentId);
  if (!a) throw httpError(404, 'Assignment not found');
  const isOwner = (a as any).assigned_to_user_id === req.user.id;
  const isMgr = isManagerTier(req.user.role);
  if (isMgr) return;
  // Non-owners can't even know the assignment exists — 404, not an oracle.
  if (!isOwner) throw httpError(404, 'Not found');
  // Owner, but consultants may only write their own student-facing evals.
  if (kind === 'SELF_12_MONTH' || kind === 'FINAL') return;
  throw httpError(403, 'Only the assigned consultant can submit this evaluation type');
}

export const listEvaluations: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const { data: a } = await repo.assignments.get(req.params.id);
  if (!a) throw httpError(404, 'Assignment not found');
  if (!isManagerTier(req.user.role) && (a as any).assigned_to_user_id !== req.user.id) {
    throw httpError(404, 'Not found');
  }
  const { data, error } = await repo.evaluations.listForAssignment(req.params.id);
  if (error) throw httpError(500, error.message);
  res.json(data ?? []);
};

export const createEvaluation: RequestHandler = async (req, res) => {
  const parsed = evalSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());
  await assertCanWriteEval(req, req.params.id, parsed.data.kind);
  const { data, error } = await repo.evaluations.create({
    ...parsed.data,
    assignment_id: req.params.id,
    created_by: req.user!.id,
  });
  if (error) throw httpError(500, error.message);
  res.status(201).json(data);
};

export const updateEvaluation: RequestHandler = async (req, res) => {
  const parsed = evalSchema.partial().safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());
  // Load existing to verify auth against the parent assignment.
  const { data: existing } = await repo.evaluations.get(req.params.evalId);
  if (!existing) throw httpError(404, 'Evaluation not found');
  await assertCanWriteEval(req, (existing as any).assignment_id, (existing as any).kind);
  const { data, error } = await repo.evaluations.update(req.params.evalId, parsed.data);
  if (error) throw httpError(500, error.message);
  res.json(data);
};

export const deleteEvaluation: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  if (!isManagerTier(req.user.role)) throw httpError(403, 'Manager-tier only');
  const { error } = await repo.evaluations.remove(req.params.evalId);
  if (error) throw httpError(500, error.message);
  res.json({ ok: true });
};

export const aiSkillGap: RequestHandler = async (req, res) => {
  const schema = z.object({
    consultant_skills: z.array(z.string()).default([]),
    job_skills: z.array(z.string()).default([]),
    resume_text: z.string().optional(),
    job_description: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());
  try {
    res.json(await ai.skillGapAnalysis(parsed.data));
  } catch (e: any) {
    throw httpError(e?.status ?? 502, e?.message ?? 'Skill gap analysis failed');
  }
};

// ---------------------------------------------------------------------------
// COMPLETION GATES — inspect what's blocking COMPLETED for an assignment.
// ---------------------------------------------------------------------------
async function assertCanReadAssignment(req: any, assignmentId: string) {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const { data: a } = await repo.assignments.get(assignmentId);
  if (!a) throw httpError(404, 'Assignment not found');
  if (!isManagerTier(req.user.role) && (a as any).assigned_to_user_id !== req.user.id) {
    throw httpError(404, 'Not found');
  }
  return a as any;
}

export const getCompletionGates: RequestHandler = async (req, res) => {
  await assertCanReadAssignment(req, req.params.id);
  const evalResult = await svc.evaluateCompletion(req.params.id);
  res.json(evalResult);
};

// ---------------------------------------------------------------------------
// ACKNOWLEDGEMENT — consultant attests they understand the material.
// One row per assignment; idempotent insert.
// ---------------------------------------------------------------------------
const ackSchema = z.object({
  acknowledgement_text: z.string().min(20).max(1000),
});
export const acknowledge: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const a = await assertCanReadAssignment(req, req.params.id);
  // Only the assignee can acknowledge — managers can't sign for the consultant.
  if (a.assigned_to_user_id !== req.user.id) {
    throw httpError(403, 'Only the assigned consultant can submit acknowledgement');
  }
  const parsed = ackSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());

  const existing = await repo.acknowledgements.getForAssignment(req.params.id);
  if ((existing as any)?.data) {
    res.json((existing as any).data);
    return;
  }
  const { data, error } = await repo.acknowledgements.create({
    assignment_id: req.params.id,
    user_id: req.user.id,
    acknowledgement_text: parsed.data.acknowledgement_text,
    ip_address: req.ip ?? null,
    user_agent: req.headers['user-agent'] ?? null,
  });
  if (error) throw httpError(500, error.message);
  await svc.recalcAssignmentStatus(req.params.id);
  res.status(201).json(data);
};

export const getAcknowledgement: RequestHandler = async (req, res) => {
  await assertCanReadAssignment(req, req.params.id);
  const r = await repo.acknowledgements.getForAssignment(req.params.id);
  res.json((r as any)?.data ?? null);
};

// ---------------------------------------------------------------------------
// FINAL ASSESSMENT — manager authors prompts, consultant submits answers,
// manager grades + approves. Single row per assignment.
// ---------------------------------------------------------------------------
const ASSESSMENT_KIND = z.enum([
  'MULTIPLE_CHOICE',
  'SHORT_ANSWER',
  'PRACTICAL_ASSIGNMENT',
  'MANAGER_REVIEW',
]);
const ASSESSMENT_STATUS = z.enum(['PENDING', 'SUBMITTED', 'APPROVED', 'REJECTED']);

const finalAssessmentAuthorSchema = z.object({
  assessment_type: ASSESSMENT_KIND,
  questions: z.any().optional(),
});
const finalAssessmentSubmitSchema = z.object({
  answers: z.any(),
});
const finalAssessmentGradeSchema = z.object({
  score: z.number().min(0).max(100).nullable().optional(),
  passed: z.boolean().nullable().optional(),
  manager_feedback: z.string().max(4000).nullable().optional(),
  approval_status: ASSESSMENT_STATUS.optional(),
});

export const getFinalAssessment: RequestHandler = async (req, res) => {
  await assertCanReadAssignment(req, req.params.id);
  const r = await repo.finalAssessments.getForAssignment(req.params.id);
  res.json((r as any)?.data ?? null);
};

/** Manager-tier: create or replace the assessment prompt for an assignment. */
export const authorFinalAssessment: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  if (!isManagerTier(req.user.role)) throw httpError(403, 'Manager-tier only');
  const parsed = finalAssessmentAuthorSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());
  await assertCanReadAssignment(req, req.params.id);

  const { data, error } = await repo.finalAssessments.upsert({
    assignment_id: req.params.id,
    assessment_type: parsed.data.assessment_type,
    questions: parsed.data.questions ?? null,
    approval_status: 'PENDING',
  });
  if (error) throw httpError(500, error.message);
  await svc.recalcAssignmentStatus(req.params.id);
  res.status(201).json(data);
};

/** Consultant: submit answers. Moves the row to SUBMITTED. */
export const submitFinalAssessment: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const a = await assertCanReadAssignment(req, req.params.id);
  if (a.assigned_to_user_id !== req.user.id) {
    throw httpError(403, 'Only the assigned consultant can submit');
  }
  const parsed = finalAssessmentSubmitSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());

  const existing = await repo.finalAssessments.getForAssignment(req.params.id);
  if (!(existing as any)?.data) throw httpError(409, 'Assessment not yet authored');

  const { data, error } = await repo.finalAssessments.upsert({
    assignment_id: req.params.id,
    assessment_type: (existing as any).data.assessment_type,
    questions: (existing as any).data.questions,
    answers: parsed.data.answers,
    submitted_at: new Date().toISOString(),
    approval_status: 'SUBMITTED',
  });
  if (error) throw httpError(500, error.message);
  await svc.recalcAssignmentStatus(req.params.id);
  res.json(data);
};

/** Manager-tier: grade + approve / reject. */
export const gradeFinalAssessment: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  if (!isManagerTier(req.user.role)) throw httpError(403, 'Manager-tier only');
  const parsed = finalAssessmentGradeSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());
  await assertCanReadAssignment(req, req.params.id);

  const existing = await repo.finalAssessments.getForAssignment(req.params.id);
  if (!(existing as any)?.data) throw httpError(404, 'No final assessment to grade');

  const patch: any = { ...parsed.data };
  if (patch.approval_status === 'APPROVED') {
    patch.approved_by = req.user.id;
    patch.approved_at = new Date().toISOString();
  }
  const { data, error } = await repo.finalAssessments.update((existing as any).data.id, patch);
  if (error) throw httpError(500, error.message);
  await svc.recalcAssignmentStatus(req.params.id);
  res.json(data);
};

// ---------------------------------------------------------------------------
// SUPERVISION NOTES — trainer/manager journal of weekly observations.
// ---------------------------------------------------------------------------
const supervisionSchema = z.object({
  note: z.string().min(1).max(4000),
  skill_progress: z.string().max(2000).nullable().optional(),
  areas_for_improvement: z.string().max(2000).nullable().optional(),
  observed_performance: z.string().max(2000).nullable().optional(),
  next_steps: z.string().max(2000).nullable().optional(),
  observed_on: z.string().optional(),
});

export const listSupervisionNotes: RequestHandler = async (req, res) => {
  await assertCanReadAssignment(req, req.params.id);
  const { data, error } = await repo.supervisionNotes.listForAssignment(req.params.id);
  if (error) throw httpError(500, error.message);
  res.json(data ?? []);
};

export const addSupervisionNote: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  if (!isManagerTier(req.user.role)) throw httpError(403, 'Manager-tier only');
  const parsed = supervisionSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());
  await assertCanReadAssignment(req, req.params.id);
  const { data, error } = await repo.supervisionNotes.create({
    ...parsed.data,
    assignment_id: req.params.id,
    trainer_user_id: req.user.id,
  });
  if (error) throw httpError(500, error.message);
  res.status(201).json(data);
};

export const updateSupervisionNote: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  if (!isManagerTier(req.user.role)) throw httpError(403, 'Manager-tier only');
  const parsed = supervisionSchema.partial().safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());
  const { data, error } = await repo.supervisionNotes.update(req.params.noteId, parsed.data);
  if (error) throw httpError(500, error.message);
  res.json(data);
};

export const deleteSupervisionNote: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  if (!isManagerTier(req.user.role)) throw httpError(403, 'Manager-tier only');
  const { error } = await repo.supervisionNotes.remove(req.params.noteId);
  if (error) throw httpError(500, error.message);
  res.json({ ok: true });
};

// ---------------------------------------------------------------------------
// TRAINING COMPLIANCE REPORT — every gate, every artifact, in one payload.
// JSON by default; ?format=csv returns a flat row-per-artifact CSV.
// ---------------------------------------------------------------------------
function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
function csvRow(cells: unknown[]): string {
  return cells.map(csvCell).join(',');
}

export const complianceReport: RequestHandler = async (req, res) => {
  const a = await assertCanReadAssignment(req, req.params.id);

  const [course, lessons, progress, uploads, feedback, attempts, ack, finalA, evals, notes, gates] =
    await Promise.all([
      repo.courses.get(a.course_id),
      repo.lessons.listByCourse(a.course_id),
      repo.progress.listForAssignment(a.id),
      repo.uploads.listForAssignment(a.id),
      repo.feedback.listForAssignment(a.id),
      repo.quizAttempts.listForAssignment(a.id),
      repo.acknowledgements.getForAssignment(a.id),
      repo.finalAssessments.getForAssignment(a.id),
      repo.evaluations.listForAssignment(a.id),
      repo.supervisionNotes.listForAssignment(a.id),
      svc.evaluateCompletion(a.id),
    ]);

  const payload = {
    assignment: a,
    course: (course as any)?.data ?? null,
    consultant: a.assignee ?? null,
    trainer_or_manager: a.assigner ?? null,
    progress: progress.data ?? [],
    lessons: lessons.data ?? [],
    quiz_attempts: attempts.data ?? [],
    assignment_uploads: uploads.data ?? [],
    feedback: feedback.data ?? [],
    supervision_notes: notes.data ?? [],
    acknowledgement: (ack as any)?.data ?? null,
    final_assessment: (finalA as any)?.data ?? null,
    evaluations: evals.data ?? [],
    gates,
    disclaimer:
      'This training record supports internal training documentation. ' +
      'Consult immigration counsel for official STEM OPT compliance requirements.',
    generated_at: new Date().toISOString(),
  };

  if (String(req.query.format ?? '').toLowerCase() !== 'csv') {
    res.json(payload);
    return;
  }

  // CSV: one section per artifact group. Easy for an auditor to paste into
  // Excel without a JSON-to-table tool.
  const sections: string[] = [];
  sections.push('Section,Field,Value');
  const cv = payload.course ?? {};
  for (const [k, v] of Object.entries({
    consultant_name: payload.consultant?.full_name,
    consultant_email: payload.consultant?.email,
    course_title: cv.title,
    compliance_category: cv.compliance_category,
    trainer: payload.trainer_or_manager?.full_name,
    start_date: a.training_start_date,
    end_date: a.training_end_date,
    due_date: a.due_date,
    status: a.status,
    progress_percentage: gates.progress_percentage,
    acknowledgement_at: payload.acknowledgement?.acknowledged_at,
    final_assessment_status: payload.final_assessment?.approval_status,
    final_assessment_score: payload.final_assessment?.score,
    blockers: gates.blockers.join('; '),
  })) {
    sections.push(csvRow(['Summary', k, v ?? '']));
  }
  sections.push('');
  sections.push('Lesson,Completed,CompletedAt,TimeSpentMinutes');
  for (const l of (lessons.data ?? []) as any[]) {
    const p = (progress.data ?? []).find((p: any) => p.lesson_id === l.id) as any;
    sections.push(
      csvRow([l.title, p?.completed ?? false, p?.completed_at ?? '', p?.time_spent_minutes ?? 0]),
    );
  }
  sections.push('');
  sections.push('QuizAttempt,QuizId,AttemptNumber,Score,Passed,AttemptedAt');
  for (const at of ((attempts.data ?? []) as any[]).sort(
    (x, y) => Number(x.attempt_number ?? 0) - Number(y.attempt_number ?? 0),
  )) {
    sections.push(
      csvRow([
        'attempt',
        at.quiz_id,
        at.attempt_number,
        at.score,
        at.passed ?? at.is_correct,
        at.attempted_at,
      ]),
    );
  }
  sections.push('');
  sections.push('SupervisionNote,Date,Trainer,Note,SkillProgress,NextSteps');
  for (const n of (notes.data ?? []) as any[]) {
    sections.push(
      csvRow([
        'note',
        n.observed_on,
        n.trainer?.full_name ?? n.trainer_user_id,
        n.note,
        n.skill_progress,
        n.next_steps,
      ]),
    );
  }
  sections.push('');
  sections.push('Evaluation,Kind,Date,HoursCompleted,Rating,StudentSigned,SupervisorSigned');
  for (const e of (evals.data ?? []) as any[]) {
    sections.push(
      csvRow([
        'evaluation',
        e.kind,
        e.evaluation_date,
        e.hours_completed,
        e.rating,
        e.student_signed_at,
        e.supervisor_signed_at,
      ]),
    );
  }
  sections.push('');
  sections.push(`Disclaimer,,${csvCell(payload.disclaimer)}`);

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="training-compliance-${a.id}.csv"`);
  res.send(sections.join('\r\n'));
};

// Returns which AI credential is active on the server so the frontend can
// skip the "choose provider" modal when already configured.
//   provider = 'subscription' → OAuth token is available (env OR ~/.claude/credentials.json)
//   provider = 'api'          → ANTHROPIC_API_KEY is set
//   provider = 'none'         → neither key is found
export const aiProviderInfo: RequestHandler = (_req, res) => {
  // Inline the same fallback logic from config/anthropic.ts so this route
  // stays lightweight and doesn't pull the Anthropic SDK into test paths.
  const {
    ANTHROPIC_OAUTH_TOKEN = '',
    ANTHROPIC_API_KEY = '',
    TRAINING_AI_PROVIDER = 'api',
  } = process.env;

  let effectiveOauthToken = ANTHROPIC_OAUTH_TOKEN;
  if (TRAINING_AI_PROVIDER === 'oauth' && effectiveOauthToken.length <= 10) {
    // Fall back to ~/.claude/credentials.json (written by `claude login`)
    try {
      const { readFileSync, existsSync } = require('node:fs') as typeof import('fs');
      const { homedir } = require('node:os') as typeof import('os');
      const { join } = require('node:path') as typeof import('path');
      const credsPath =
        process.env.CLAUDE_CREDS_FILE ?? join(homedir(), '.claude', 'credentials.json');
      if (existsSync(credsPath)) {
        const parsed = JSON.parse(readFileSync(credsPath, 'utf8')) as Record<string, unknown>;
        effectiveOauthToken =
          (parsed.oauthToken as string | undefined) ||
          (parsed.accessToken as string | undefined) ||
          ((parsed.claudeAiOAuth as Record<string, unknown> | undefined)?.accessToken as
            | string
            | undefined) ||
          '';
      }
    } catch {
      // ignore — falls through to 'none'
    }
  }

  const provider =
    TRAINING_AI_PROVIDER === 'oauth' && effectiveOauthToken.length > 10
      ? 'subscription'
      : ANTHROPIC_API_KEY.length > 10
        ? 'api'
        : 'none';

  res.json({ provider });
};

// ---------------------------------------------------------------------------
// AI generation status — live view of all course/lesson generation activity
// ---------------------------------------------------------------------------
export const aiGenerationStatus: RequestHandler = async (_req, res) => {
  const { pool } = await import('../config/db');

  const [courseRows, lessonRows, activeCourses, activeAndFailedLessons] = await Promise.all([
    pool.query<{ content_status: string; count: string }>(
      `SELECT coalesce(content_status, 'UNKNOWN') AS content_status, count(*)::int AS count
       FROM training_courses GROUP BY content_status`,
    ),
    pool.query<{ content_status: string; count: string }>(
      `SELECT coalesce(content_status, 'UNKNOWN') AS content_status, count(*)::int AS count
       FROM training_lessons GROUP BY content_status`,
    ),
    pool.query(
      `SELECT tc.id, tc.title, tc.category, tc.difficulty, tc.content_status, tc.updated_at,
              count(tl.id)::int AS total_lessons,
              count(tl.id) FILTER (WHERE tl.content_status = 'READY')::int AS ready_lessons,
              count(tl.id) FILTER (WHERE tl.content_status = 'GENERATING')::int AS generating_lessons,
              count(tl.id) FILTER (WHERE tl.content_status = 'FAILED')::int AS failed_lessons,
              count(tl.id) FILTER (WHERE tl.content_status = 'PENDING')::int AS pending_lessons
       FROM training_courses tc
       LEFT JOIN training_lessons tl ON tl.course_id = tc.id
       WHERE tc.content_status IN ('GENERATING','OUTLINE_READY','FAILED','PENDING')
          OR EXISTS (
            SELECT 1 FROM training_lessons tl2
            WHERE tl2.course_id = tc.id
              AND tl2.content_status IN ('GENERATING','FAILED','PENDING')
          )
       GROUP BY tc.id
       ORDER BY tc.updated_at DESC
       LIMIT 50`,
    ),
    pool.query(
      `SELECT tl.id, tl.title, tl.content_status, tl.updated_at, tl.course_id,
              tc.title AS course_title
       FROM training_lessons tl
       JOIN training_courses tc ON tc.id = tl.course_id
       WHERE tl.content_status IN ('GENERATING','FAILED','PENDING')
       ORDER BY tl.updated_at DESC
       LIMIT 100`,
    ),
  ]);

  const courseStats = Object.fromEntries(
    courseRows.rows.map((r) => [r.content_status, Number(r.count)]),
  );
  const lessonStats = Object.fromEntries(
    lessonRows.rows.map((r) => [r.content_status, Number(r.count)]),
  );

  res.json({
    course_stats: courseStats,
    lesson_stats: lessonStats,
    active_courses: activeCourses.rows,
    active_lessons: activeAndFailedLessons.rows,
  });
};
