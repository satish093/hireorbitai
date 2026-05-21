import { RequestHandler } from 'express';
import { z } from 'zod';
import { db } from '../config/db';
import { httpError } from '../types';

// Per-recruiter weekly targets for the dashboard WeeklyGoals card. The caller
// reads/writes only their own goals (keyed off their recruiter row). The
// `current` values are computed client-side from the dashboard's data; this
// endpoint owns the configurable TARGETS only.

const GOAL_TYPES = ['submissions', 'interviews', 'offers', 'bench_refresh'] as const;
type GoalType = (typeof GOAL_TYPES)[number];
const DEFAULTS: Record<GoalType, number> = {
  submissions: 10,
  interviews: 4,
  offers: 2,
  bench_refresh: 100,
};
const MISSING = /schema cache|relation .* does not exist|column .* does not exist/i;

async function recruiterRowId(userId: string): Promise<string | null> {
  const { data } = await db.from('recruiters').select('id').eq('user_id', userId).maybeSingle();
  return (data as { id?: string } | null)?.id ?? null;
}

export const getGoals: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const recId = await recruiterRowId(req.user.id);
  const targets: Record<GoalType, number> = { ...DEFAULTS };
  if (recId) {
    const { data, error } = await db
      .from('recruiter_goals')
      .select('goal_type, target')
      .eq('recruiter_id', recId);
    if (error) {
      // Table not migrated yet → fall back to defaults rather than 500.
      if (!MISSING.test(error.message)) throw httpError(500, error.message);
    } else {
      for (const g of (data ?? []) as { goal_type: string; target: number }[]) {
        if ((GOAL_TYPES as readonly string[]).includes(g.goal_type)) {
          targets[g.goal_type as GoalType] = g.target;
        }
      }
    }
  }
  res.json(GOAL_TYPES.map((t) => ({ goal_type: t, target: targets[t] })));
};

const setSchema = z
  .object({
    goals: z.array(
      z.object({ goal_type: z.enum(GOAL_TYPES), target: z.number().int().min(0).max(100_000) }),
    ),
  })
  .strict();

export const setGoals: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const recId = await recruiterRowId(req.user.id);
  if (!recId) throw httpError(403, 'Only recruiters can set goals');
  const parsed = setSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid goals', parsed.error.flatten());
  const now = new Date().toISOString();
  for (const g of parsed.data.goals) {
    const { error } = await db
      .from('recruiter_goals')
      .upsert(
        { recruiter_id: recId, goal_type: g.goal_type, target: g.target, updated_at: now },
        { onConflict: 'recruiter_id,goal_type' },
      );
    if (error) {
      if (MISSING.test(error.message)) throw httpError(503, 'Goals storage not migrated yet');
      throw httpError(500, error.message);
    }
  }
  res.json({ ok: true });
};
