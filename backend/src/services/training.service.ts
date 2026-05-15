import * as repo from '../repositories/training.repository';

/**
 * Business rules + cross-table orchestration for the Training module.
 * Controllers stay thin; everything that needs to read more than one table or
 * compute derived state lives here.
 */

/**
 * Roll up lesson-progress counts onto the assignment row:
 *   progress_percentage = completed / total * 100
 *   status              = NOT_STARTED | IN_PROGRESS | COMPLETED  (OVERDUE handled separately)
 *   completed_at        = now() when 100%
 *
 * Called after every progress upsert.
 */
export async function recalcAssignmentProgress(assignmentId: string): Promise<void> {
  const { data: a } = await repo.assignments.get(assignmentId);
  if (!a) return;
  const { completed, total } = await repo.progress.countsFor(assignmentId, (a as any).course_id);
  const pct = total > 0 ? Math.round((completed / total) * 10000) / 100 : 0;

  const patch: any = { progress_percentage: pct };
  if (pct >= 100) {
    patch.status = 'COMPLETED';
    patch.completed_at = new Date().toISOString();
  } else if (pct > 0) {
    patch.status = 'IN_PROGRESS';
    patch.completed_at = null;
  } else {
    patch.status = 'NOT_STARTED';
    patch.completed_at = null;
  }
  await repo.assignments.update(assignmentId, patch);
}

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
  await recalcAssignmentProgress(input.assignment_id);
}

/** Cron-style: stamp OVERDUE on anything past due_date that isn't COMPLETED.
 *  Cheap enough to run on every list-assignments call. */
export async function flagOverdue(): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await repo.assignments.list({});
  for (const a of (data as any[]) ?? []) {
    if (a.status !== 'COMPLETED' && a.due_date && a.due_date < today && a.status !== 'OVERDUE') {
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
  completion_rate: number;
  top_consultants: Array<{ user_id: string; completed: number }>;
  by_category: Array<{ category: string; courses: number }>;
}> {
  const { data: courses } = await repo.courses.list({});
  const { data: assignments } = await repo.assignments.list({});

  const allCourses = (courses ?? []) as any[];
  const allAssignments = (assignments ?? []) as any[];

  const completed = allAssignments.filter((a) => a.status === 'COMPLETED');
  const overdue = allAssignments.filter((a) => a.status === 'OVERDUE');

  // Top consultants (completed assignments).
  const byUser = new Map<string, number>();
  for (const a of completed) {
    byUser.set(a.assigned_to_user_id, (byUser.get(a.assigned_to_user_id) ?? 0) + 1);
  }
  const top = Array.from(byUser.entries())
    .map(([user_id, n]) => ({ user_id, completed: n }))
    .sort((a, b) => b.completed - a.completed)
    .slice(0, 10);

  // Course count per category.
  const byCat = new Map<string, number>();
  for (const c of allCourses) byCat.set(c.category, (byCat.get(c.category) ?? 0) + 1);
  const byCategory = Array.from(byCat.entries())
    .map(([category, courses]) => ({ category, courses }))
    .sort((a, b) => b.courses - a.courses);

  return {
    total_courses: allCourses.length,
    active_courses: allCourses.filter((c) => c.status === 'ACTIVE').length,
    total_assignments: allAssignments.length,
    completed_assignments: completed.length,
    overdue_assignments: overdue.length,
    completion_rate:
      allAssignments.length > 0 ? Math.round((completed.length / allAssignments.length) * 100) : 0,
    top_consultants: top,
    by_category: byCategory,
  };
}
