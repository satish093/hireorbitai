import { db } from '../config/db';
import * as repo from '../repositories/training.repository';
import * as ai from './trainingAI.service';
import { httpError } from '../types';

/**
 * Business rules + cross-table orchestration for the Training module.
 * Controllers stay thin; everything that needs to read more than one table or
 * compute derived state lives here.
 *
 * Completion is a HARD multi-gate evaluation (STEM OPT compliance spec).
 * Frontend can flip individual lesson_progress rows, but the assignment
 * status is recomputed server-side from the gate state — there is no path
 * for the client to set status = COMPLETED directly.
 */

type AssignmentStatus =
  | 'NOT_STARTED'
  | 'IN_PROGRESS'
  | 'QUIZ_PENDING'
  | 'ASSIGNMENT_PENDING'
  | 'FINAL_ASSESSMENT_PENDING'
  | 'MANAGER_REVIEW_PENDING'
  // All gates passed, but the learner hasn't pressed "Complete" yet. The
  // status machine no longer auto-flips to COMPLETED — completion is an
  // explicit action (see completeAssignment).
  | 'READY_TO_COMPLETE'
  | 'COMPLETED'
  | 'FAILED'
  | 'OVERDUE';

export interface GateState {
  lessons: { completed: number; total: number; ok: boolean };
  time: { minutes: number; required: number | null; ok: boolean };
  quiz: { score: number | null; passing: number | null; attempts_exceeded: boolean; ok: boolean };
  uploads: { submitted: number; required: number; ok: boolean };
  acknowledgement: { acknowledged: boolean; ok: boolean };
  final_assessment: { exists: boolean; passed: boolean; ok: boolean };
  manager_approval: { required: boolean; approved: boolean; ok: boolean };
}

export interface CompletionEvaluation {
  status: AssignmentStatus;
  progress_percentage: number;
  blockers: string[];
  gates: GateState;
}

// ===========================================================================
// VERSIONING — snapshot-on-publish so assignments pin a stable course version.
// ===========================================================================

/**
 * Assemble the immutable course payload that gets frozen at publish time.
 * Lesson + quiz ids are the live ids so existing progress / quiz-attempt rows
 * (keyed by lesson_id / quiz_id) stay valid across the version.
 */
export async function buildCourseSnapshot(courseId: string): Promise<any> {
  const [courseRes, lessonsRes, quizzesRes] = await Promise.all([
    repo.courses.get(courseId),
    repo.lessons.listByCourse(courseId),
    repo.quizzes.listByCourse(courseId, { includeAnswers: true }),
  ]);
  const c: any = (courseRes as any)?.data ?? {};
  const lessons = (lessonsRes.data ?? []) as any[];
  const quizzes = (quizzesRes.data ?? []) as any[];

  const byLesson = new Map<string, any[]>();
  for (const q of quizzes) {
    if (!q.lesson_id) continue;
    const arr = byLesson.get(q.lesson_id) ?? [];
    arr.push(q);
    byLesson.set(q.lesson_id, arr);
  }

  return {
    course: {
      title: c.title,
      description: c.description,
      overview: c.overview,
      category: c.category,
      difficulty: c.difficulty,
      estimated_duration_hours: c.estimated_duration_hours,
      learning_objectives: c.learning_objectives,
      skills_taught: c.skills_taught,
      expected_outcomes: c.expected_outcomes,
      roadmap: c.roadmap,
      resources: c.resources,
      completion_criteria: {
        minimum_time_minutes: c.minimum_time_minutes,
        quiz_passing_score: c.quiz_passing_score,
        quiz_max_attempts: c.quiz_max_attempts,
        requires_manager_approval: c.requires_manager_approval,
      },
      stem_relevance: c.stem_relevance,
      weekly_hours: c.weekly_hours,
      assessment_methods: c.assessment_methods,
      target_audience: c.target_audience,
      thumbnail_url: c.thumbnail_url,
      tags: c.tags,
    },
    lessons: lessons.map((l) => ({
      id: l.id,
      title: l.title,
      summary: l.summary,
      description: l.description,
      content: l.content,
      content_format: l.content_format,
      practical_example: l.practical_example,
      exercises: l.exercises,
      key_takeaways: l.key_takeaways,
      video_url: l.video_url,
      document_url: l.document_url,
      lesson_order: l.lesson_order,
      estimated_minutes: l.estimated_minutes,
      knowledge_check_required: l.knowledge_check_required,
      quiz: byLesson.get(l.id) ?? [],
    })),
    quizzes,
    capstone: c.capstone ?? null,
  };
}

/**
 * Publish: freeze a snapshot as the next version, then flip the course to
 * PUBLISHED/ACTIVE pointing at it. The guard (≥1 lesson, all READY) runs in the
 * controller before this is called.
 */
export async function publishCourse(
  courseId: string,
  userId: string,
): Promise<{ course: any; version: { id: string; version_number: number } }> {
  const version = await snapshotCourse(courseId, userId);
  const { data: updated } = await repo.courses.update(courseId, {
    status: 'ACTIVE',
    content_status: 'READY',
    review_status: 'PUBLISHED',
    current_version_id: version.id,
  });
  return { course: updated, version };
}

/** Freeze the next immutable version of a course and return it. Does NOT touch
 *  the course's lifecycle columns — callers decide what to flip. */
async function snapshotCourse(
  courseId: string,
  userId: string,
): Promise<{ id: string; version_number: number }> {
  const snapshot = await buildCourseSnapshot(courseId);
  const version_number = (await repo.courseVersions.maxNumber(courseId)) + 1;
  const { data: ver, error } = await repo.courseVersions.create({
    course_id: courseId,
    version_number,
    snapshot,
    published_by: userId,
  });
  if (error || !ver) throw httpError(500, 'Failed to snapshot course');
  return { id: (ver as any).id as string, version_number };
}

/**
 * Resolve the version an assignment should pin. Uses the course's current
 * published version; if a legacy ACTIVE course was never published through the
 * new flow (e.g. the seeded courses), it self-heals by snapshotting one now so
 * assignments are always version-pinned. Only DRAFT/unpublished courses are
 * rejected.
 */
async function ensureCurrentVersion(course: any, userId: string): Promise<string> {
  if (course.current_version_id) return course.current_version_id;
  if (course.status === 'ACTIVE') {
    const version = await snapshotCourse(course.id, userId);
    await repo.courses.update(course.id, {
      current_version_id: version.id,
      review_status: 'PUBLISHED',
    });
    return version.id;
  }
  throw httpError(409, 'Publish the course before assigning it.');
}

/**
 * The single source of course content for an assignment. Returns the pinned
 * version snapshot when the assignment was created against a published version,
 * else the live tables (legacy assignments). Includes quiz answer keys — strip
 * them before sending to a student (see stripQuizAnswers).
 */
export async function resolveAssignmentContent(
  a: any,
): Promise<{ course: any; lessons: any[]; quizzes: any[]; versioned: boolean }> {
  if (a?.course_version_id) {
    const { data: ver } = await repo.courseVersions.get(a.course_version_id);
    const snap = (ver as any)?.snapshot;
    if (snap) {
      return {
        course: snap.course ?? {},
        lessons: (snap.lessons ?? []) as any[],
        quizzes: (snap.quizzes ?? []) as any[],
        versioned: true,
      };
    }
  }
  const courseId = a.course_id as string;
  const [c, ls, qz] = await Promise.all([
    repo.courses.get(courseId),
    repo.lessons.listByCourse(courseId),
    repo.quizzes.listByCourse(courseId, { includeAnswers: true }),
  ]);
  return {
    course: (c as any)?.data ?? {},
    lessons: (ls.data ?? []) as any[],
    quizzes: (qz.data ?? []) as any[],
    versioned: false,
  };
}

/** Remove answer-key fields so resolved content is safe to send to a student. */
export function stripQuizAnswers(content: { course: any; lessons: any[]; quizzes: any[] }): {
  course: any;
  lessons: any[];
  quizzes: any[];
} {
  const strip = (q: any) => {
    const { correct_answer: _c, explanation: _e, ...rest } = q ?? {};
    return rest;
  };
  return {
    course: content.course,
    lessons: (content.lessons ?? []).map((l) => ({ ...l, quiz: (l.quiz ?? []).map(strip) })),
    quizzes: (content.quizzes ?? []).map(strip),
  };
}

/**
 * Enrich-only: generate the surrounding structure (overview, objectives,
 * roadmap, resources, completion criteria, capstone) for an existing course
 * WITHOUT touching its lessons or quizzes. Used to backfill hand-seeded courses.
 */
export async function enrichCourse(courseId: string): Promise<{ degraded: boolean }> {
  const { data: course } = await repo.courses.get(courseId);
  if (!course) throw httpError(404, 'Course not found');
  const c: any = course;
  const lessonTitles = ((c.lessons ?? []) as any[]).map((l) => l.title).filter(Boolean);

  const { data: meta, degraded } = await ai.enrichCourseMeta({
    title: c.title,
    category: c.category,
    difficulty: c.difficulty,
    target_audience: c.target_audience,
    existing_lesson_titles: lessonTitles,
  });

  const cc = meta.completion_criteria;
  await repo.courses.update(courseId, {
    overview: meta.overview,
    learning_objectives: meta.learning_objectives,
    skills_taught: meta.skills_taught,
    expected_outcomes: meta.expected_outcomes,
    roadmap: meta.roadmap,
    resources: meta.resources,
    capstone: meta.capstone,
    minimum_time_minutes: cc.minimum_time_minutes,
    quiz_passing_score: cc.quiz_passing_score,
    quiz_max_attempts: cc.quiz_max_attempts,
    requires_manager_approval: cc.requires_manager_approval,
  });
  return { degraded };
}

/**
 * Backfill: enrich every course that's missing structured content (no
 * overview). Non-destructive — lessons/quizzes are never touched.
 */
export async function backfillCourses(): Promise<
  Array<{ id: string; title: string; result: 'enriched' | 'skipped' | 'failed' }>
> {
  const { data: courses } = await repo.courses.list({});
  const out: Array<{ id: string; title: string; result: 'enriched' | 'skipped' | 'failed' }> = [];
  for (const c of (courses ?? []) as any[]) {
    if (c.overview) {
      out.push({ id: c.id, title: c.title, result: 'skipped' });
      continue;
    }
    try {
      const { degraded } = await enrichCourse(c.id);
      out.push({ id: c.id, title: c.title, result: degraded ? 'failed' : 'enriched' });
    } catch {
      out.push({ id: c.id, title: c.title, result: 'failed' });
    }
  }
  return out;
}

/** Resolve a single quiz (with its answer key) for grading, version-aware. */
export async function getAssignmentQuiz(a: any, quizId: string): Promise<any | null> {
  if (a?.course_version_id) {
    const { data: ver } = await repo.courseVersions.get(a.course_version_id);
    const quizzes = ((ver as any)?.snapshot?.quizzes ?? []) as any[];
    return quizzes.find((q) => q.id === quizId) ?? null;
  }
  const { data } = await repo.quizzes.get(quizId);
  return (data as any) ?? null;
}

/**
 * Evaluate every completion gate for an assignment. Returns the derived
 * status + a human-readable list of what's still blocking completion. This
 * is the ONLY function allowed to compute a final status.
 */
export async function evaluateCompletion(assignmentId: string): Promise<CompletionEvaluation> {
  const { data: aRow } = await repo.assignments.get(assignmentId);
  if (!aRow) {
    return {
      status: 'NOT_STARTED',
      progress_percentage: 0,
      blockers: ['assignment not found'],
      gates: emptyGates(),
    };
  }
  const a: any = aRow;

  // Course content comes from the pinned version (or live tables for legacy
  // assignments) so gates evaluate against the version the student was assigned.
  const content = await resolveAssignmentContent(a);
  const course: any = content.course ?? {};
  // Snapshot stores completion_criteria nested; live course has flat columns.
  const cc = course.completion_criteria ?? course;

  const [progressRows, attempts, uploads, ack, fa] = await Promise.all([
    repo.progress.listForAssignment(assignmentId),
    repo.quizAttempts.listForAssignment(assignmentId),
    repo.uploads.listForAssignment(assignmentId),
    repo.acknowledgements.getForAssignment(assignmentId),
    repo.finalAssessments.getForAssignment(assignmentId),
  ]);

  const lessonRows = content.lessons;
  const progress = (progressRows.data ?? []) as any[];
  const quizRows = content.quizzes;
  const attemptRows = (attempts.data ?? []) as any[];
  const uploadRows = (uploads.data ?? []) as any[];
  const ackRow = (ack as any)?.data ?? null;
  const faRow = (fa as any)?.data ?? null;

  const gates: GateState = {
    lessons: lessonGate(lessonRows, progress),
    time: timeGate(progress, cc.minimum_time_minutes),
    quiz: quizGate(quizRows, attemptRows, cc),
    uploads: uploadGate(lessonRows, uploadRows),
    acknowledgement: acknowledgementGate(ackRow),
    final_assessment: finalAssessmentGate(faRow),
    manager_approval: managerApprovalGate(cc, faRow),
  };

  const { status, blockers } = deriveStatus(gates);

  // Lesson-progress percentage is the user-facing number on the dashboard,
  // distinct from the boolean "everything done" gate. Keeps the existing UI
  // bars meaningful even when other gates are blocking COMPLETED.
  const pct =
    gates.lessons.total > 0
      ? Math.round((gates.lessons.completed / gates.lessons.total) * 10000) / 100
      : 0;

  return {
    status,
    progress_percentage: pct,
    blockers,
    gates,
  };
}

function emptyGates(): GateState {
  return {
    lessons: { completed: 0, total: 0, ok: false },
    time: { minutes: 0, required: null, ok: true },
    quiz: { score: null, passing: null, attempts_exceeded: false, ok: true },
    uploads: { submitted: 0, required: 0, ok: true },
    acknowledgement: { acknowledged: false, ok: false },
    final_assessment: { exists: false, passed: false, ok: true },
    manager_approval: { required: false, approved: false, ok: true },
  };
}

function lessonGate(lessons: any[], progress: any[]): GateState['lessons'] {
  const total = lessons.length;
  const doneIds = new Set(progress.filter((p) => p.completed).map((p) => p.lesson_id));
  const completed = lessons.filter((l) => doneIds.has(l.id)).length;
  return { completed, total, ok: total === 0 || completed === total };
}

function timeGate(progress: any[], required: number | null | undefined): GateState['time'] {
  const minutes = progress.reduce((sum, p) => sum + Number(p.time_spent_minutes ?? 0), 0);
  const r = required == null ? null : Number(required);
  return { minutes, required: r, ok: r == null || r === 0 || minutes >= r };
}

function quizGate(questions: any[], attempts: any[], course: any): GateState['quiz'] {
  // No quiz authored → gate is satisfied trivially.
  if (questions.length === 0) {
    return { score: null, passing: null, attempts_exceeded: false, ok: true };
  }
  const passing = course.quiz_passing_score == null ? null : Number(course.quiz_passing_score);
  const maxAttempts = course.quiz_max_attempts == null ? null : Number(course.quiz_max_attempts);

  // Most-recent attempt per quiz_id.
  const latestByQuiz = new Map<string, any>();
  // Highest attempt_number per quiz_id (for max-attempts check).
  const attemptCountByQuiz = new Map<string, number>();
  for (const at of attempts) {
    const prev = latestByQuiz.get(at.quiz_id);
    const ts = new Date(at.attempted_at ?? 0).getTime();
    if (!prev || ts > new Date(prev.attempted_at ?? 0).getTime()) {
      latestByQuiz.set(at.quiz_id, at);
    }
    const n = Number(at.attempt_number ?? 1);
    attemptCountByQuiz.set(at.quiz_id, Math.max(attemptCountByQuiz.get(at.quiz_id) ?? 0, n));
  }

  // Has the user exceeded max_attempts on any unpassed quiz?
  let attemptsExceeded = false;
  if (maxAttempts != null) {
    for (const q of questions) {
      const count = attemptCountByQuiz.get(q.id) ?? 0;
      const latest = latestByQuiz.get(q.id);
      const latestPassed = !!latest && (latest.passed ?? latest.is_correct);
      if (count > maxAttempts && !latestPassed) {
        attemptsExceeded = true;
        break;
      }
    }
  }

  // Score = sum(points of correctly-answered questions, latest attempt) / total points.
  let earned = 0;
  let possible = 0;
  for (const q of questions) {
    const pts = Number(q.points ?? 1);
    possible += pts;
    const latest = latestByQuiz.get(q.id);
    if (latest && (latest.passed ?? latest.is_correct)) earned += pts;
  }
  const score = possible > 0 ? Math.round((earned / possible) * 10000) / 100 : 0;

  // No passing threshold set → any submission counts; require ALL latest-attempts pass.
  const ok =
    passing == null
      ? latestByQuiz.size === questions.length &&
        Array.from(latestByQuiz.values()).every((a) => a.passed ?? a.is_correct)
      : !attemptsExceeded && score >= passing;

  return { score, passing, attempts_exceeded: attemptsExceeded, ok };
}

function uploadGate(lessons: any[], uploads: any[]): GateState['uploads'] {
  // Spec leaves "required assignments" undefined in the base schema. We
  // count lessons that explicitly mark knowledge_check_required as needing
  // a submission; total goes to 0 (auto-pass) if none are required.
  const required = lessons.filter((l) => l.knowledge_check_required).length;
  const submitted = uploads.length;
  return { submitted, required, ok: required === 0 || submitted >= required };
}

function acknowledgementGate(ack: any | null): GateState['acknowledgement'] {
  const acknowledged = !!ack;
  return { acknowledged, ok: acknowledged };
}

function finalAssessmentGate(fa: any | null): GateState['final_assessment'] {
  if (!fa) return { exists: false, passed: false, ok: true };
  const passed = !!fa.passed && fa.approval_status !== 'REJECTED';
  return { exists: true, passed, ok: passed };
}

function managerApprovalGate(course: any, fa: any | null): GateState['manager_approval'] {
  const required = !!course?.requires_manager_approval;
  if (!required) return { required: false, approved: true, ok: true };
  const approved = !!fa && fa.approval_status === 'APPROVED';
  return { required, approved, ok: approved };
}

/**
 * Derive the assignment status from the gate state. Order matters — the
 * status reflects the FIRST blocking gate so the consultant knows what to
 * do next, but `blockers` lists everything still missing for full
 * transparency on the manager side.
 */
function deriveStatus(g: GateState): { status: AssignmentStatus; blockers: string[] } {
  const blockers: string[] = [];
  if (!g.lessons.ok) blockers.push(`lessons (${g.lessons.completed}/${g.lessons.total})`);
  if (!g.time.ok)
    blockers.push(`minimum study time (${g.time.minutes}/${g.time.required} minutes)`);
  if (!g.uploads.ok)
    blockers.push(`assignment uploads (${g.uploads.submitted}/${g.uploads.required})`);
  if (g.quiz.attempts_exceeded) blockers.push('quiz attempts exceeded — course failed');
  else if (!g.quiz.ok)
    blockers.push(`quiz score (${g.quiz.score ?? '—'}/${g.quiz.passing ?? '—'})`);
  if (g.final_assessment.exists && !g.final_assessment.ok)
    blockers.push('final assessment not passed');
  if (!g.acknowledgement.ok) blockers.push('acknowledgement not submitted');
  if (!g.manager_approval.ok) blockers.push('awaiting manager approval');

  // FAILED is terminal — overrides everything else.
  if (g.quiz.attempts_exceeded) return { status: 'FAILED', blockers };

  // No work done at all.
  if (
    g.lessons.completed === 0 &&
    blockers.length === Object.keys(g).filter((k) => !(g as any)[k].ok).length
  ) {
    // Heuristic: if NOTHING has been started, surface NOT_STARTED.
    const anyTouched =
      g.lessons.completed > 0 ||
      g.time.minutes > 0 ||
      g.acknowledgement.acknowledged ||
      g.final_assessment.exists ||
      (g.quiz.score ?? 0) > 0;
    if (!anyTouched) return { status: 'NOT_STARTED', blockers };
  }

  // All gates green → the learner may now finish. We deliberately DON'T return
  // COMPLETED here: completion is an explicit click (completeAssignment), not an
  // automatic side effect of finishing the last lesson/quiz.
  if (blockers.length === 0) return { status: 'READY_TO_COMPLETE', blockers };

  // First blocker on the "after lessons" axis surfaces a specific pending state.
  if (!g.lessons.ok || !g.time.ok || !g.uploads.ok) return { status: 'IN_PROGRESS', blockers };
  if (!g.quiz.ok) return { status: 'QUIZ_PENDING', blockers };
  if (g.final_assessment.exists && !g.final_assessment.ok)
    return { status: 'FINAL_ASSESSMENT_PENDING', blockers };
  if (!g.acknowledgement.ok)
    return {
      status: g.final_assessment.exists ? 'FINAL_ASSESSMENT_PENDING' : 'IN_PROGRESS',
      blockers,
    };
  if (!g.manager_approval.ok) return { status: 'MANAGER_REVIEW_PENDING', blockers };
  return { status: 'IN_PROGRESS', blockers };
}

/**
 * Recompute the assignment row from its gate state and persist any change.
 * Called after every progress / quiz / acknowledgement / final-assessment
 * write. Idempotent.
 */
export async function recalcAssignmentStatus(assignmentId: string): Promise<CompletionEvaluation> {
  const evalResult = await evaluateCompletion(assignmentId);

  // Completion is now an explicit learner action. A recalc must never auto-flip
  // a row to COMPLETED, and must never UN-complete a row that the learner already
  // finished (e.g. a later progress write or a manager edit). So: preserve an
  // existing COMPLETED status; otherwise persist the freshly derived status,
  // which now tops out at READY_TO_COMPLETE.
  const { data: current } = await repo.assignments.get(assignmentId);
  const alreadyCompleted = (current as { status?: string } | null)?.status === 'COMPLETED';

  const patch: any = { progress_percentage: evalResult.progress_percentage };
  if (alreadyCompleted) {
    patch.status = 'COMPLETED';
  } else {
    patch.status = evalResult.status;
    patch.completed_at = null;
  }
  await repo.assignments.update(assignmentId, patch);
  return alreadyCompleted ? { ...evalResult, status: 'COMPLETED' } : evalResult;
}

/**
 * Explicit learner completion. Re-evaluates the gates and only flips the row to
 * COMPLETED when every requirement is met (status READY_TO_COMPLETE). Throws a
 * 4xx with the outstanding blockers otherwise — there's still no path to
 * COMPLETED that skips the gates.
 */
export async function completeAssignment(assignmentId: string): Promise<CompletionEvaluation> {
  const evalResult = await evaluateCompletion(assignmentId);
  if (evalResult.status === 'COMPLETED') return evalResult; // idempotent
  if (evalResult.status === 'FAILED') {
    throw httpError(409, 'This course was not passed and cannot be completed.');
  }
  if (evalResult.status !== 'READY_TO_COMPLETE') {
    throw httpError(
      400,
      `Not all requirements are met yet: ${evalResult.blockers.join('; ') || 'in progress'}.`,
    );
  }
  await repo.assignments.update(assignmentId, {
    status: 'COMPLETED',
    progress_percentage: evalResult.progress_percentage,
    completed_at: new Date().toISOString(),
  });
  return { ...evalResult, status: 'COMPLETED' };
}

/** Legacy alias — keep so older callers don't break. */
export const recalcAssignmentProgress = recalcAssignmentStatus;

/** Pass through to the repo, but also fire the recalc so the assignment row
 *  stays in sync with its lesson_progress children. */
export async function markLessonProgress(input: {
  assignment_id: string;
  lesson_id: string;
  completed: boolean;
  time_spent_minutes?: number;
}): Promise<void> {
  await repo.progress.upsert({
    assignment_id: input.assignment_id,
    lesson_id: input.lesson_id,
    completed: input.completed,
    completed_at: input.completed ? new Date().toISOString() : null,
    time_spent_minutes: input.time_spent_minutes ?? 0,
    updated_at: new Date().toISOString(),
  });
  await recalcAssignmentStatus(input.assignment_id);
}

/**
 * Record a quiz attempt with the correct attempt_number. The repository
 * stores the row; we compute attempt_number = previous_max + 1 here so the
 * service is the single writer of that counter.
 */
export async function recordQuizAttempt(input: {
  assignment_id: string;
  quiz_id: string;
  selected_answer: string;
  selected_answers?: unknown;
  is_correct: boolean;
  score: number;
}): Promise<any> {
  // Look up previous attempts to derive the next attempt_number.
  const { data: prior } = await db
    .from('training_quiz_attempts')
    .select('attempt_number')
    .eq('assignment_id', input.assignment_id)
    .eq('quiz_id', input.quiz_id);
  const used = ((prior as any[]) ?? []).map((r) => Number(r.attempt_number ?? 0));
  const next = (used.length === 0 ? 0 : Math.max(...used)) + 1;

  const { data, error } = await repo.quizAttempts.record({
    assignment_id: input.assignment_id,
    quiz_id: input.quiz_id,
    selected_answer: input.selected_answer,
    selected_answers: input.selected_answers ?? null,
    is_correct: input.is_correct,
    passed: input.is_correct,
    score: input.score,
    attempt_number: next,
  });
  if (error) throw new Error(error.message);
  await recalcAssignmentStatus(input.assignment_id);
  return data;
}

/** Cron-style: stamp OVERDUE on anything past due_date that isn't COMPLETED/FAILED.
 *  Cheap enough to run on every list-assignments call. */
export async function flagOverdue(): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await repo.assignments.list({});
  for (const a of (data as any[]) ?? []) {
    const terminal = a.status === 'COMPLETED' || a.status === 'FAILED';
    if (!terminal && a.due_date && a.due_date < today && a.status !== 'OVERDUE') {
      await repo.assignments.update(a.id, { status: 'OVERDUE' });
    }
  }
}

/**
 * Bulk-assign a course to N users.
 * Skips users who already have an assignment for that course (unique constraint
 * does the dedup; we just collect the new rows).
 */
export async function bulkAssignCourse(input: {
  course_id: string;
  user_ids: string[];
  assigned_by_user_id: string;
  due_date?: string | null;
}): Promise<{ created: any[]; skipped: string[] }> {
  const created: any[] = [];
  const skipped: string[] = [];

  // Assignments pin the course's current published version so later edits +
  // re-publishes (which create a new version) never mutate in-flight records.
  // Legacy ACTIVE courses with no version self-heal (see ensureCurrentVersion).
  const { data: courseRow } = await repo.courses.get(input.course_id);
  const course: any = courseRow ?? {};
  const versionId = await ensureCurrentVersion(course, input.assigned_by_user_id);
  const capstone: any = course.capstone ?? null;

  for (const uid of input.user_ids) {
    const { data, error } = await repo.assignments.create({
      course_id: input.course_id,
      course_version_id: versionId,
      assigned_to_user_id: uid,
      assigned_by_user_id: input.assigned_by_user_id,
      due_date: input.due_date ?? null,
      status: 'NOT_STARTED',
      progress_percentage: 0,
    });
    if (error) {
      if (/duplicate|unique/i.test(error.message)) skipped.push(uid);
      else throw new Error(error.message);
    } else if (data) {
      created.push(data);
      if (capstone?.assessment_type) {
        // Idempotent on (assignment_id); ignore failures so a capstone hiccup
        // never blocks the assignment itself.
        await repo.finalAssessments
          .upsert({
            assignment_id: (data as any).id,
            assessment_type: capstone.assessment_type,
            questions: capstone,
            approval_status: 'PENDING',
          })
          .catch(() => undefined);
      }
    }
  }
  return { created, skipped };
}

/** Manager reports: completion rate, overdue count, top consultants, plus
 *  quiz pass rate + time-spent analytics. */
export async function reports(
  opts: {
    /** When provided, scope assignments + quiz attempts + lesson progress to
     *  only these user-ids (HR_MANAGER / MANAGER group scope). Admin-tier and
     *  workspace-wide callers omit this; an empty array means "no one"
     *  (fail-closed) and returns zeroed aggregates. The course catalog itself
     *  is workspace-wide regardless — it's not user-scoped data. */
    scopeUserIds?: string[];
  } = {},
): Promise<{
  total_courses: number;
  active_courses: number;
  total_assignments: number;
  completed_assignments: number;
  in_progress_assignments: number;
  overdue_assignments: number;
  failed_assignments: number;
  completion_rate: number;
  quiz_pass_rate: number;
  avg_time_spent_minutes: number;
  total_time_spent_minutes: number;
  top_consultants: Array<{ user_id: string; completed: number }>;
  by_category: Array<{ category: string; courses: number }>;
  by_compliance_category: Array<{ compliance_category: string; courses: number }>;
}> {
  const { data: courses } = await repo.courses.list({});
  const { data: assignments } = await repo.assignments.list(
    opts.scopeUserIds ? { assigned_to_user_id_in: opts.scopeUserIds } : {},
  );

  const allAssignmentsTmp = (assignments ?? []) as any[];
  // For scoped (group-lead) reports, restrict quiz-attempts + lesson-progress
  // aggregates to the same assignment-id set so a manager can't see a peer
  // group's training time / pass-rate. Empty assignment set fails closed.
  const scopedAssignmentIds = opts.scopeUserIds
    ? allAssignmentsTmp.map((a) => a.id as string)
    : null;
  const [{ data: attempts }, { data: progress }] = await Promise.all([
    scopedAssignmentIds === null
      ? db.from('training_quiz_attempts').select('passed, is_correct')
      : scopedAssignmentIds.length === 0
        ? Promise.resolve({ data: [], error: null })
        : db
            .from('training_quiz_attempts')
            .select('passed, is_correct')
            .in('assignment_id', scopedAssignmentIds),
    scopedAssignmentIds === null
      ? db.from('training_lesson_progress').select('time_spent_minutes')
      : scopedAssignmentIds.length === 0
        ? Promise.resolve({ data: [], error: null })
        : db
            .from('training_lesson_progress')
            .select('time_spent_minutes')
            .in('assignment_id', scopedAssignmentIds),
  ]);

  const allCourses = (courses ?? []) as any[];
  const allAssignments = allAssignmentsTmp;

  const completed = allAssignments.filter((a) => a.status === 'COMPLETED');
  const overdue = allAssignments.filter((a) => a.status === 'OVERDUE');
  const failed = allAssignments.filter((a) => a.status === 'FAILED');
  const inProgress = allAssignments.filter(
    (a) => !['NOT_STARTED', 'COMPLETED', 'FAILED'].includes(a.status),
  );

  const allAttempts = (attempts ?? []) as any[];
  const passedAttempts = allAttempts.filter((x) => x.passed ?? x.is_correct).length;
  const quizPassRate =
    allAttempts.length > 0 ? Math.round((passedAttempts / allAttempts.length) * 100) : 0;

  const totalMinutes = ((progress ?? []) as any[]).reduce(
    (sum, p) => sum + Number(p.time_spent_minutes ?? 0),
    0,
  );
  const avgMinutes =
    allAssignments.length > 0 ? Math.round(totalMinutes / allAssignments.length) : 0;

  // Top consultants (completed assignments).
  const byUser = new Map<string, number>();
  for (const a of completed) {
    byUser.set(a.assigned_to_user_id, (byUser.get(a.assigned_to_user_id) ?? 0) + 1);
  }
  const top = Array.from(byUser.entries())
    .map(([user_id, n]) => ({ user_id, completed: n }))
    .sort((a, b) => b.completed - a.completed)
    .slice(0, 10);

  // Course count per category (free-text) + compliance category (spec enum).
  const byCat = new Map<string, number>();
  const byCompliance = new Map<string, number>();
  for (const c of allCourses) {
    if (c.category) byCat.set(c.category, (byCat.get(c.category) ?? 0) + 1);
    if (c.compliance_category)
      byCompliance.set(c.compliance_category, (byCompliance.get(c.compliance_category) ?? 0) + 1);
  }
  const byCategory = Array.from(byCat.entries())
    .map(([category, courses]) => ({ category, courses }))
    .sort((a, b) => b.courses - a.courses);
  const byComplianceCategory = Array.from(byCompliance.entries())
    .map(([compliance_category, courses]) => ({ compliance_category, courses }))
    .sort((a, b) => b.courses - a.courses);

  return {
    total_courses: allCourses.length,
    active_courses: allCourses.filter((c) => c.status === 'ACTIVE').length,
    total_assignments: allAssignments.length,
    completed_assignments: completed.length,
    in_progress_assignments: inProgress.length,
    overdue_assignments: overdue.length,
    failed_assignments: failed.length,
    completion_rate:
      allAssignments.length > 0 ? Math.round((completed.length / allAssignments.length) * 100) : 0,
    quiz_pass_rate: quizPassRate,
    avg_time_spent_minutes: avgMinutes,
    total_time_spent_minutes: totalMinutes,
    top_consultants: top,
    by_category: byCategory,
    by_compliance_category: byComplianceCategory,
  };
}
