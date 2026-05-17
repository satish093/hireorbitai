import { db } from '../config/db';
import * as repo from '../repositories/training.repository';

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
  const courseId = a.course_id as string;

  // Course row carries gate thresholds (passing_score, min_time, etc.).
  const { data: cRow } = await repo.courses.get(courseId);
  const course: any = cRow ?? {};

  const [lessons, progressRows, quizQuestions, attempts, uploads, ack, fa] = await Promise.all([
    repo.lessons.listByCourse(courseId),
    repo.progress.listForAssignment(assignmentId),
    repo.quizzes.listByCourse(courseId),
    repo.quizAttempts.listForAssignment(assignmentId),
    repo.uploads.listForAssignment(assignmentId),
    repo.acknowledgements.getForAssignment(assignmentId),
    repo.finalAssessments.getForAssignment(assignmentId),
  ]);

  const lessonRows = (lessons.data ?? []) as any[];
  const progress = (progressRows.data ?? []) as any[];
  const quizRows = (quizQuestions.data ?? []) as any[];
  const attemptRows = (attempts.data ?? []) as any[];
  const uploadRows = (uploads.data ?? []) as any[];
  const ackRow = (ack as any)?.data ?? null;
  const faRow = (fa as any)?.data ?? null;

  const gates: GateState = {
    lessons: lessonGate(lessonRows, progress),
    time: timeGate(progress, course.minimum_time_minutes),
    quiz: quizGate(quizRows, attemptRows, course),
    uploads: uploadGate(lessonRows, uploadRows),
    acknowledgement: acknowledgementGate(ackRow),
    final_assessment: finalAssessmentGate(faRow),
    manager_approval: managerApprovalGate(course, faRow),
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

  // All gates green → COMPLETED.
  if (blockers.length === 0) return { status: 'COMPLETED', blockers };

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
  const patch: any = {
    progress_percentage: evalResult.progress_percentage,
    status: evalResult.status,
    completed_at: evalResult.status === 'COMPLETED' ? new Date().toISOString() : null,
  };
  await repo.assignments.update(assignmentId, patch);
  return evalResult;
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
  for (const uid of input.user_ids) {
    const { data, error } = await repo.assignments.create({
      course_id: input.course_id,
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
    }
  }
  return { created, skipped };
}

/** Manager reports: completion rate, overdue count, top consultants. */
export async function reports(): Promise<{
  total_courses: number;
  active_courses: number;
  total_assignments: number;
  completed_assignments: number;
  overdue_assignments: number;
  failed_assignments: number;
  completion_rate: number;
  top_consultants: Array<{ user_id: string; completed: number }>;
  by_category: Array<{ category: string; courses: number }>;
  by_compliance_category: Array<{ compliance_category: string; courses: number }>;
}> {
  const { data: courses } = await repo.courses.list({});
  const { data: assignments } = await repo.assignments.list({});

  const allCourses = (courses ?? []) as any[];
  const allAssignments = (assignments ?? []) as any[];

  const completed = allAssignments.filter((a) => a.status === 'COMPLETED');
  const overdue = allAssignments.filter((a) => a.status === 'OVERDUE');
  const failed = allAssignments.filter((a) => a.status === 'FAILED');

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
    overdue_assignments: overdue.length,
    failed_assignments: failed.length,
    completion_rate:
      allAssignments.length > 0 ? Math.round((completed.length / allAssignments.length) * 100) : 0,
    top_consultants: top,
    by_category: byCategory,
    by_compliance_category: byComplianceCategory,
  };
}
