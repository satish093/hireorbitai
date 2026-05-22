import { pool } from '../config/db';
import { logger } from '../config/logger';

/**
 * Gamification engine for the training workspace. Achievement criteria live in
 * the `training_achievements` registry as `{ type, threshold }`; this service
 * computes the matching metrics from real training data and awards any newly
 * earned badges. Everything here is best-effort — it must never throw into a
 * request path (a missing migration just means no awards yet).
 */

type Metric =
  | 'lessons_completed'
  | 'courses_completed'
  | 'compliance_completed'
  | 'study_minutes'
  | 'study_days'
  | 'quiz_perfect';

async function computeMetrics(userId: string): Promise<Record<Metric, number>> {
  const r = await pool.query<Record<Metric, string>>(
    `SELECT
       (SELECT count(*) FROM public.training_lesson_progress lp
          JOIN public.training_assignments a ON a.id = lp.assignment_id
         WHERE a.assigned_to_user_id = $1 AND lp.completed)                       AS lessons_completed,
       (SELECT count(*) FROM public.training_assignments a
         WHERE a.assigned_to_user_id = $1 AND a.status = 'COMPLETED')             AS courses_completed,
       (SELECT count(*) FROM public.training_assignments a
          JOIN public.training_courses c ON c.id = a.course_id
         WHERE a.assigned_to_user_id = $1 AND a.status = 'COMPLETED'
           AND c.compliance_category IS NOT NULL)                                 AS compliance_completed,
       (SELECT coalesce(sum(minutes), 0) FROM public.training_activity_daily
         WHERE user_id = $1)                                                      AS study_minutes,
       (SELECT count(*) FROM public.training_activity_daily
         WHERE user_id = $1 AND minutes > 0)                                      AS study_days,
       (SELECT count(*) FROM public.training_quiz_attempts qa
          JOIN public.training_assignments a ON a.id = qa.assignment_id
         WHERE a.assigned_to_user_id = $1 AND qa.passed IS TRUE)                  AS quiz_perfect`,
    [userId],
  );
  const row = r.rows[0];
  const get = (k: Metric) => Number(row?.[k] ?? 0) || 0;
  return {
    lessons_completed: get('lessons_completed'),
    courses_completed: get('courses_completed'),
    compliance_completed: get('compliance_completed'),
    study_minutes: get('study_minutes'),
    study_days: get('study_days'),
    quiz_perfect: get('quiz_perfect'),
  };
}

/** Re-evaluate every achievement for a user and award newly-earned ones. */
export async function evaluateAchievements(userId: string): Promise<void> {
  try {
    const metrics = await computeMetrics(userId);
    const reg = await pool.query<{
      id: string;
      criteria_json: { type?: Metric; threshold?: number };
    }>(`SELECT id, criteria_json FROM public.training_achievements`);
    const earned: string[] = [];
    for (const a of reg.rows) {
      const type = a.criteria_json?.type;
      const threshold = a.criteria_json?.threshold ?? 1;
      if (type && metrics[type] !== undefined && metrics[type] >= threshold) earned.push(a.id);
    }
    if (earned.length === 0) return;
    await pool.query(
      `INSERT INTO public.training_user_achievements (user_id, achievement_id)
       SELECT $1, unnest($2::uuid[])
       ON CONFLICT (user_id, achievement_id) DO NOTHING`,
      [userId, earned],
    );
  } catch (e) {
    logger.warn({ err: e }, 'evaluateAchievements failed (training migration applied?)');
  }
}

/** Add `minutes` to today's study tally for the heatmap. Best-effort. */
export async function logStudyMinutes(userId: string, minutes: number): Promise<void> {
  if (!minutes || minutes <= 0) return;
  try {
    await pool.query(
      `INSERT INTO public.training_activity_daily (user_id, activity_date, minutes)
       VALUES ($1, current_date, $2)
       ON CONFLICT (user_id, activity_date)
       DO UPDATE SET minutes = public.training_activity_daily.minutes + EXCLUDED.minutes`,
      [userId, Math.round(minutes)],
    );
  } catch (e) {
    logger.warn({ err: e }, 'logStudyMinutes failed (training migration applied?)');
  }
}
