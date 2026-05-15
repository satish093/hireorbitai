import { RequestHandler } from 'express';
import { z } from 'zod';
import * as repo from '../repositories/training.repository';
import * as svc from '../services/training.service';
import * as ai from '../services/trainingAI.service';
import { httpError, MANAGER_TIER } from '../types';

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
  res.json(data);
};

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
  const { data, error } = await repo.courses.update(req.params.id, parsed.data);
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
  const { data, error } = await repo.lessons.update(req.params.id, parsed.data);
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
    throw httpError(403, 'Forbidden');
  }
  // Hydrate lesson progress + uploads + feedback + quiz attempts for the
  // assignment-detail view in one round-trip.
  const [pr, up, fb, qa] = await Promise.all([
    repo.progress.listForAssignment(a.id),
    repo.uploads.listForAssignment(a.id),
    repo.feedback.listForAssignment(a.id),
    repo.quizAttempts.listForAssignment(a.id),
  ]);
  res.json({
    ...a,
    lesson_progress: pr.data ?? [],
    uploads: up.data ?? [],
    feedback: fb.data ?? [],
    quiz_attempts: qa.data ?? [],
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
    throw httpError(403, 'Forbidden');
  }

  await svc.markLessonProgress({
    assignment_id: req.params.id,
    lesson_id: parsed.data.lesson_id,
    completed: parsed.data.completed,
    time_spent_minutes: parsed.data.time_spent_minutes ?? undefined,
  });
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
export const listQuiz: RequestHandler = async (req, res) => {
  const { data, error } = await repo.quizzes.listByCourse(req.params.id);
  if (error) throw httpError(500, error.message);
  res.json(data ?? []);
};

const quizAttemptSchema = z.object({
  quiz_id: z.string().uuid(),
  selected_answer: z.string(),
});
export const submitQuizAttempt: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const parsed = quizAttemptSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());

  const { data: quiz, error: qErr } = await repo.quizzes.get(parsed.data.quiz_id);
  if (qErr || !quiz) throw httpError(404, 'Quiz not found');

  const isCorrect = parsed.data.selected_answer === (quiz as any).correct_answer;
  const score = isCorrect ? Number((quiz as any).points ?? 1) : 0;

  const { data, error } = await repo.quizAttempts.record({
    assignment_id: req.params.id,
    quiz_id: parsed.data.quiz_id,
    selected_answer: parsed.data.selected_answer,
    is_correct: isCorrect,
    score,
  });
  if (error) throw httpError(500, error.message);
  res
    .status(201)
    .json({
      ...data,
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
  res.json(await ai.generateTrainingPlan(parsed.data));
};

export const aiInterviewQuestions: RequestHandler = async (req, res) => {
  const schema = z.object({
    job_description: z.string().min(20),
    skills: z.array(z.string()).default([]),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());
  res.json(await ai.generateInterviewQuestions(parsed.data));
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

  const out = await ai.generateQuiz({
    lesson_content: parsed.data.lesson_content,
    count: parsed.data.count,
  });

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
    await repo.quizzes.createMany(rows);
  }
  res.json(out);
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
  // Consultants can only write their own student-facing evals.
  if (isOwner && (kind === 'SELF_12_MONTH' || kind === 'FINAL')) return;
  throw httpError(403, 'Forbidden');
}

export const listEvaluations: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const { data: a } = await repo.assignments.get(req.params.id);
  if (!a) throw httpError(404, 'Assignment not found');
  if (!isManagerTier(req.user.role) && (a as any).assigned_to_user_id !== req.user.id) {
    throw httpError(403, 'Forbidden');
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
  res.json(await ai.skillGapAnalysis(parsed.data));
};
