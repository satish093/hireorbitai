import { RequestHandler } from 'express';
import { z } from 'zod';
import { db } from '../config/db';
import { httpError, MANAGER_TIER } from '../types';

function isManagerTier(role?: string): boolean {
  return !!role && (MANAGER_TIER as string[]).includes(role);
}

/**
 * Resolve the recruiter row id for the calling user (if they are a recruiter).
 * Returns null when the caller isn't a recruiter or has no row yet.
 */
async function getCallerRecruiterRowId(userId: string): Promise<string | null> {
  const { data } = await db.from('recruiters').select('id').eq('user_id', userId).maybeSingle();
  return data?.id ?? null;
}

const onboardingSchema = z.object({
  visa_status: z.string().optional(),
  current_location: z.string().optional(),
  preferred_locations: z.array(z.string()).optional(),
  primary_skill: z.string().optional(),
  total_experience_years: z.number().optional(),
  relocation: z.boolean().optional(),
  remote_only: z.boolean().optional(),
  expected_rate: z.number().optional(),
  linkedin_url: z.string().url().optional().or(z.literal('')),
  github_url: z.string().url().optional().or(z.literal('')),
  notes: z.string().optional(),
  desired_positions: z.array(z.string()).optional(),
  skills: z.array(z.string()).optional(),
});

export const list: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const recruiter_id = req.query.recruiter_id as string | undefined;
  let q = db
    .from('consultants')
    .select(
      '*, user:users(id, email, full_name, phone, group_id),' +
        'recruiter:recruiters!recruiter_id(id, team, user:users!user_id(id, email, full_name, group_id))',
    )
    .order('created_at', { ascending: false });

  // Scope by caller's role:
  //   ADMIN_TIER / MANAGER: full visibility (optional ?recruiter_id filter)
  //   RECRUITER: only consultants assigned to them
  //   CONSULTANT: only their own row
  if (isManagerTier(req.user.role)) {
    if (recruiter_id) q = q.eq('recruiter_id', recruiter_id);
  } else if (req.user.role === 'RECRUITER') {
    const myRecId = await getCallerRecruiterRowId(req.user.id);
    if (!myRecId) {
      res.json([]);
      return;
    }
    q = q.eq('recruiter_id', myRecId);
  } else if (req.user.role === 'CONSULTANT') {
    q = q.eq('user_id', req.user.id);
  } else {
    res.json([]);
    return;
  }

  const { data, error } = await q;
  if (error) throw httpError(500, error.message);
  res.json(data);
};

export const get: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const { data, error } = await db
    .from('consultants')
    .select(
      '*, user:users(id, email, full_name, phone, avatar_url, group_id),' +
        'recruiter:recruiters!recruiter_id(id, team, user:users!user_id(id, email, full_name, group_id))',
    )
    .eq('id', req.params.id)
    .single();
  if (error || !data) throw httpError(404, error?.message ?? 'Not found');
  const row = data as any;

  // Scope: same rules as list.
  if (!isManagerTier(req.user.role)) {
    if (req.user.role === 'RECRUITER') {
      const myRecId = await getCallerRecruiterRowId(req.user.id);
      if (!myRecId || row.recruiter_id !== myRecId) throw httpError(403, 'Forbidden');
    } else if (req.user.role === 'CONSULTANT') {
      if (row.user_id !== req.user.id) throw httpError(403, 'Forbidden');
    } else {
      throw httpError(403, 'Forbidden');
    }
  }
  res.json(row);
};

export const onboard: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const parsed = onboardingSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());

  const payload: Record<string, unknown> = { user_id: req.user.id, ...parsed.data };
  let { data, error } = await db
    .from('consultants')
    .upsert(payload, { onConflict: 'user_id' })
    .select()
    .single();
  // Optional-column migrations may not be applied yet — strip and retry so
  // the rest of the fields still save instead of hard-failing the whole call.
  for (const col of ['desired_positions', 'skills']) {
    if (
      error &&
      new RegExp(col).test(error.message) &&
      /schema cache|column/i.test(error.message)
    ) {
      delete payload[col];
      ({ data, error } = await db
        .from('consultants')
        .upsert(payload, { onConflict: 'user_id' })
        .select()
        .single());
    }
  }
  if (error) throw httpError(500, error.message);
  res.json(data);
};

export const update: RequestHandler = async (req, res) => {
  const { data, error } = await db
    .from('consultants')
    .update(req.body ?? {})
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) throw httpError(500, error.message);
  res.json(data);
};

export const assignRecruiter: RequestHandler = async (req, res) => {
  const recruiter_id = req.body?.recruiter_id;
  if (!recruiter_id) throw httpError(400, 'recruiter_id required');
  const { data, error } = await db
    .from('consultants')
    .update({ recruiter_id })
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) throw httpError(500, error.message);
  res.json(data);
};

export const setMarketingStatus: RequestHandler = async (req, res) => {
  const schema = z.object({ marketing_status: z.enum(['ACTIVE', 'PAUSED', 'PLACED']) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid status');
  const { data, error } = await db
    .from('consultants')
    .update({ marketing_status: parsed.data.marketing_status })
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) throw httpError(500, error.message);
  res.json(data);
};
