import { RequestHandler } from 'express';
import { z } from 'zod';
import { pool } from '../config/db';
import { httpError } from '../types';
import { evaluateAchievements } from '../services/trainingAchievements.service';

// ---------------------------------------------------------------------------
// Training learning-workspace endpoints (the redesigned /training surface).
//
// These read across the assignment/lesson/quiz tables plus the new workspace
// tables (study plans, ratings, activity, achievements). Reads degrade to an
// empty/null payload rather than 500 if a migration isn't applied yet — the
// rest of the workspace keeps working.
// ---------------------------------------------------------------------------

function uid(req: Parameters<RequestHandler>[0]): string {
  if (!req.user) throw httpError(401, 'Not authenticated');
  return req.user.id;
}

// GET /training/catalog — active courses with avg rating + enrolled count.
export const getCatalog: RequestHandler = async (req, res) => {
  const userId = uid(req);
  try {
    const r = await pool.query(
      `SELECT c.id, c.title, c.category, c.tags, c.estimated_duration_hours,
              c.compliance_category, c.difficulty,
              coalesce(round(avg(r.rating)::numeric, 1), 0)::float AS rating,
              count(DISTINCT r.id)::int                            AS rating_count,
              count(DISTINCT a.id)::int                            AS enrolled,
              bool_or(a.assigned_to_user_id = $1)                  AS enrolled_by_me
         FROM public.training_courses c
         LEFT JOIN public.training_course_ratings r ON r.course_id = c.id
         LEFT JOIN public.training_assignments a    ON a.course_id = c.id
        WHERE c.status = 'ACTIVE'
        GROUP BY c.id
        ORDER BY c.title ASC`,
      [userId],
    );
    res.json(r.rows);
  } catch {
    // Ratings table not migrated yet — fall back to a plain active-course list.
    try {
      const r = await pool.query(
        `SELECT c.id, c.title, c.category, c.tags, c.estimated_duration_hours,
                c.compliance_category, c.difficulty,
                0::float AS rating, 0 AS rating_count,
                count(DISTINCT a.id)::int AS enrolled,
                bool_or(a.assigned_to_user_id = $1) AS enrolled_by_me
           FROM public.training_courses c
           LEFT JOIN public.training_assignments a ON a.course_id = c.id
          WHERE c.status = 'ACTIVE'
          GROUP BY c.id ORDER BY c.title ASC`,
        [userId],
      );
      res.json(r.rows);
    } catch {
      res.json([]);
    }
  }
};

// GET /training/continue — most-recent in-progress assignment + next lesson.
export const getContinue: RequestHandler = async (req, res) => {
  const userId = uid(req);
  try {
    const r = await pool.query(
      `SELECT a.id AS assignment_id, a.course_id, a.progress_percentage,
              c.title AS course_title,
              l.title AS lesson_title, l.estimated_minutes
         FROM public.training_assignments a
         JOIN public.training_courses c ON c.id = a.course_id
         LEFT JOIN LATERAL (
           SELECT l.title, l.estimated_minutes
             FROM public.training_lessons l
             LEFT JOIN public.training_lesson_progress lp
               ON lp.lesson_id = l.id AND lp.assignment_id = a.id
            WHERE l.course_id = a.course_id AND coalesce(lp.completed, false) = false
            ORDER BY l.lesson_order ASC
            LIMIT 1
         ) l ON true
        WHERE a.assigned_to_user_id = $1 AND a.status = 'IN_PROGRESS'
        ORDER BY a.updated_at DESC NULLS LAST
        LIMIT 1`,
      [userId],
    );
    const row = r.rows[0];
    if (!row) return res.json(null);
    res.json({
      assignment_id: row.assignment_id,
      course_id: row.course_id,
      course_title: row.course_title,
      lesson_title: row.lesson_title ?? null,
      percent: Math.round(Number(row.progress_percentage) || 0),
      remaining_min: row.estimated_minutes ?? null,
    });
  } catch {
    res.json(null);
  }
};

// GET /training/compliance — required/compliance courses with a derived status.
export const getCompliance: RequestHandler = async (req, res) => {
  const userId = uid(req);
  try {
    const r = await pool.query(
      `SELECT a.id AS assignment_id, a.status, a.due_date, a.progress_percentage,
              c.title, c.compliance_category
         FROM public.training_assignments a
         JOIN public.training_courses c ON c.id = a.course_id
        WHERE a.assigned_to_user_id = $1 AND c.compliance_category IS NOT NULL
        ORDER BY a.due_date ASC NULLS LAST`,
      [userId],
    );
    const now = Date.now();
    const DAY = 86_400_000;
    const items = r.rows.map((row) => {
      const due = row.due_date ? new Date(row.due_date).getTime() : null;
      const done = row.status === 'COMPLETED';
      let tone: 'success' | 'danger' | 'warn' | 'muted' = 'muted';
      if (done) tone = 'success';
      else if (due != null && due < now) tone = 'danger';
      else if (due != null && due - now <= 7 * DAY) tone = 'warn';
      return {
        assignment_id: row.assignment_id,
        title: row.title,
        category: row.compliance_category,
        status: row.status,
        due_date: row.due_date,
        percent: Math.round(Number(row.progress_percentage) || 0),
        tone,
      };
    });
    const dueSoon = items.filter((i) => i.tone === 'danger' || i.tone === 'warn').length;
    res.json({ items, due_soon: dueSoon });
  } catch {
    res.json({ items: [], due_soon: 0 });
  }
};

// GET /training/activity?days=14 — zero-filled per-day study minutes.
export const getActivity: RequestHandler = async (req, res) => {
  const userId = uid(req);
  const days = Math.min(60, Math.max(1, Number((req.query.days as string) ?? 14)));
  const series: { date: string; minutes: number }[] = [];
  const byDate = new Map<string, number>();
  try {
    const r = await pool.query<{ activity_date: string; minutes: string }>(
      `SELECT to_char(activity_date, 'YYYY-MM-DD') AS activity_date, minutes
         FROM public.training_activity_daily
        WHERE user_id = $1 AND activity_date >= current_date - ($2::int - 1)`,
      [userId, days],
    );
    for (const row of r.rows) byDate.set(row.activity_date, Number(row.minutes) || 0);
  } catch {
    /* table missing → all zeros */
  }
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    series.push({ date: key, minutes: byDate.get(key) ?? 0 });
  }
  // Current streak = trailing consecutive days with minutes > 0.
  let streak = 0;
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i]!.minutes > 0) streak++;
    else break;
  }
  const best = (() => {
    let run = 0;
    let max = 0;
    for (const d of series) {
      run = d.minutes > 0 ? run + 1 : 0;
      max = Math.max(max, run);
    }
    return max;
  })();
  res.json({ series, streak, best });
};

// GET /training/achievements — registry left-joined with what the user earned.
export const getAchievements: RequestHandler = async (req, res) => {
  const userId = uid(req);
  try {
    await evaluateAchievements(userId);
    const r = await pool.query(
      `SELECT t.key, t.title, t.description, t.tone,
              ua.earned_at
         FROM public.training_achievements t
         LEFT JOIN public.training_user_achievements ua
           ON ua.achievement_id = t.id AND ua.user_id = $1
        ORDER BY t.sort_order ASC`,
      [userId],
    );
    res.json(r.rows);
  } catch {
    res.json([]);
  }
};

// GET /training/plans/active — latest active plan + items grouped by week.
export const getActivePlan: RequestHandler = async (req, res) => {
  const userId = uid(req);
  try {
    const planRes = await pool.query(
      `SELECT id, title, rationale, created_at
         FROM public.training_study_plans
        WHERE user_id = $1 AND status = 'active'
        ORDER BY created_at DESC LIMIT 1`,
      [userId],
    );
    const plan = planRes.rows[0];
    if (!plan) return res.json(null);
    const itemsRes = await pool.query(
      `SELECT id, week_no, week_label, focus_area, title, item_type, duration_min,
              course_id, completed
         FROM public.training_study_plan_items
        WHERE plan_id = $1
        ORDER BY week_no ASC, sort_order ASC`,
      [plan.id],
    );
    res.json({ ...plan, items: itemsRes.rows });
  } catch {
    res.json(null);
  }
};

// POST /training/plans/generate — build a real plan from the user's active
// (non-completed) courses' incomplete lessons, distributed into weeks.
export const generatePlan: RequestHandler = async (req, res) => {
  const userId = uid(req);
  try {
    const lessonsRes = await pool.query(
      `SELECT c.id AS course_id, c.title AS course_title,
              l.title AS lesson_title, l.estimated_minutes, l.lesson_order
         FROM public.training_assignments a
         JOIN public.training_courses c ON c.id = a.course_id
         JOIN public.training_lessons l ON l.course_id = c.id
         LEFT JOIN public.training_lesson_progress lp
           ON lp.lesson_id = l.id AND lp.assignment_id = a.id
        WHERE a.assigned_to_user_id = $1
          AND a.status <> 'COMPLETED'
          AND coalesce(lp.completed, false) = false
        ORDER BY c.title ASC, l.lesson_order ASC`,
      [userId],
    );
    const lessons = lessonsRes.rows;
    if (lessons.length === 0) {
      throw httpError(400, 'Nothing to plan yet — enrol in a course first.');
    }

    // Archive any current active plan, then create a fresh one.
    await pool.query(
      `UPDATE public.training_study_plans SET status = 'archived', updated_at = now()
        WHERE user_id = $1 AND status = 'active'`,
      [userId],
    );
    const titleCount = new Set(lessons.map((l) => l.course_title)).size;
    const planRes = await pool.query(
      `INSERT INTO public.training_study_plans (user_id, title, rationale)
       VALUES ($1, $2, $3) RETURNING id`,
      [
        userId,
        `Study plan across ${titleCount} ${titleCount === 1 ? 'course' : 'courses'}`,
        'Built from the lessons you still have left in your enrolled courses, paced about five items a week.',
      ],
    );
    const planId = planRes.rows[0].id as string;

    const PER_WEEK = 5;
    const values: string[] = [];
    const params: unknown[] = [planId];
    lessons.forEach((l, i) => {
      const week = Math.floor(i / PER_WEEK) + 1;
      const base = params.length;
      params.push(
        week,
        `Week ${week}`,
        l.course_title,
        l.lesson_title,
        'Lesson',
        l.estimated_minutes ?? null,
        l.course_id,
        i % PER_WEEK,
      );
      values.push(
        `($1, $${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8})`,
      );
    });
    await pool.query(
      `INSERT INTO public.training_study_plan_items
         (plan_id, week_no, week_label, focus_area, title, item_type, duration_min, course_id, sort_order)
       VALUES ${values.join(', ')}`,
      params,
    );
    res.status(201).json({ id: planId });
  } catch (e) {
    if ((e as { status?: number }).status) throw e;
    req.log.error({ err: e }, '[generatePlan] failed');
    throw httpError(500, 'Could not generate a plan. The training tables may not be migrated yet.');
  }
};

// PATCH /training/plans/items/:id — toggle a plan item's completion (own plan).
const itemSchema = z.object({ completed: z.boolean() });
export const togglePlanItem: RequestHandler = async (req, res) => {
  const userId = uid(req);
  const parsed = itemSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid input');
  const r = await pool.query(
    `UPDATE public.training_study_plan_items i
        SET completed = $1, completed_at = CASE WHEN $1 THEN now() ELSE NULL END
       FROM public.training_study_plans p
      WHERE i.id = $2 AND i.plan_id = p.id AND p.user_id = $3
      RETURNING i.id`,
    [parsed.data.completed, req.params.id, userId],
  );
  if (r.rowCount === 0) throw httpError(404, 'Not found');
  res.json({ ok: true });
};

// POST /training/enroll { course_id } — self-enrol (creates an assignment).
const enrollSchema = z.object({ course_id: z.string().uuid() });
export const enroll: RequestHandler = async (req, res) => {
  const userId = uid(req);
  const parsed = enrollSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'A course is required');
  const { course_id } = parsed.data;
  const existing = await pool.query(
    `SELECT id FROM public.training_assignments
      WHERE assigned_to_user_id = $1 AND course_id = $2 LIMIT 1`,
    [userId, course_id],
  );
  if (existing.rows[0]) return res.json({ id: existing.rows[0].id, already: true });
  const r = await pool.query(
    `INSERT INTO public.training_assignments (course_id, assigned_to_user_id, status, progress_percentage)
     VALUES ($1, $2, 'NOT_STARTED', 0) RETURNING id`,
    [course_id, userId],
  );
  res.status(201).json({ id: r.rows[0].id });
};

// POST /training/courses/:id/rate { rating } — upsert a 1–5 rating.
const rateSchema = z.object({ rating: z.number().int().min(1).max(5) });
export const rateCourse: RequestHandler = async (req, res) => {
  const userId = uid(req);
  const parsed = rateSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Rating must be 1–5');
  await pool.query(
    `INSERT INTO public.training_course_ratings (course_id, user_id, rating)
     VALUES ($1, $2, $3)
     ON CONFLICT (course_id, user_id) DO UPDATE SET rating = EXCLUDED.rating, created_at = now()`,
    [req.params.id, userId, parsed.data.rating],
  );
  res.json({ ok: true });
};
