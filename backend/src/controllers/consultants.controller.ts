import { RequestHandler } from 'express';
import { z } from 'zod';
import { db } from '../config/db';
import { httpError, MANAGER_TIER } from '../types';
import { invalidatePermissionCache } from '../services/permission.service';
import {
  managerGroupUserIds,
  isAdminTier,
  isGroupLead,
  leadCanAccessUser,
} from '../services/groupScope';
import { audit } from '../services/audit.service';

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

const onboardingSchema = z
  .object({
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
  })
  .strict();

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
    // A MANAGER is confined to their own group; HR_MANAGER + admin-tier are not.
    const groupUserIds = await managerGroupUserIds(req.user);
    if (groupUserIds !== null) {
      if (groupUserIds.length === 0) {
        res.json([]);
        return;
      }
      q = q.in('user_id', groupUserIds);
    }
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
  if (error) throw httpError(500, 'Database error');

  // Bench matches: `?matchFor=:jobId` scores the (already role-scoped) list of
  // consultants against a job's required skills and returns the strong matches.
  // No extra IDOR surface — scoring is layered on top of the same scoped rows.
  const matchFor = req.query.matchFor as string | undefined;
  if (matchFor) {
    res.json(await scoreConsultantsForJob(data ?? [], matchFor));
    return;
  }

  res.json(data);
};

/** Lowercase + trim a skills array; tolerates non-arrays. */
function normalizeSkills(arr: unknown): string[] {
  if (!Array.isArray(arr)) return [];
  return arr.map((s) => String(s).trim().toLowerCase()).filter(Boolean);
}

/**
 * Score consultants against a job by skill overlap (consultant skills ∩ job
 * required skills), mirroring the recommended-feed baseline. Returns a flat
 * shape the Job Search bench card consumes, filtered to >= 65% and capped.
 */
async function scoreConsultantsForJob(
  rows: {
    id: string;
    skills?: unknown;
    primary_skill?: string | null;
    user?: { full_name?: string | null } | null;
  }[],
  jobId: string,
) {
  const { data: job } = await db
    .from('jobs')
    .select('id, required_skills, requirements')
    .eq('id', jobId)
    .maybeSingle();
  const j = job as {
    required_skills?: string[];
    requirements?: { required_skills?: string[] };
  } | null;
  const need = normalizeSkills(
    j?.requirements?.required_skills?.length
      ? j.requirements.required_skills
      : (j?.required_skills ?? []),
  );
  if (need.length === 0) return [];
  const needSet = new Set(need);

  return rows
    .map((c) => {
      const have = normalizeSkills(
        Array.isArray(c.skills) && c.skills.length
          ? c.skills
          : c.primary_skill
            ? String(c.primary_skill).split(/[,;]/)
            : [],
      );
      const overlap = have.filter((s) => needSet.has(s)).length;
      const match_score = Math.round((overlap / need.length) * 100);
      return {
        id: c.id,
        full_name: c.user?.full_name ?? null,
        title: c.primary_skill ?? null,
        match_score,
      };
    })
    .filter((m) => m.match_score >= 65)
    .sort((a, b) => b.match_score - a.match_score)
    .slice(0, 8);
}

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

  // Scope: same rules as list. Return 404 (not 403) so the endpoint can't
  // be used to probe whether a consultant id exists. Admin tier is unscoped;
  // group leads (HR_MANAGER/MANAGER) are confined to their own group.
  if (isAdminTier(req.user.role)) {
    // unscoped — full visibility
  } else if (isGroupLead(req.user.role)) {
    if (!(await leadCanAccessUser(req.user, row.user_id))) throw httpError(404, 'Not found');
  } else if (req.user.role === 'RECRUITER') {
    const myRecId = await getCallerRecruiterRowId(req.user.id);
    if (!myRecId || row.recruiter_id !== myRecId) throw httpError(404, 'Not found');
  } else if (req.user.role === 'CONSULTANT') {
    if (row.user_id !== req.user.id) throw httpError(404, 'Not found');
  } else {
    throw httpError(404, 'Not found');
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
  if (error) throw httpError(500, 'Database error');
  res.json(data);
};

export const update: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  // Field allowlist — `user_id`, `recruiter_id`, and `marketing_status` are
  // intentionally not patchable here; they have their own dedicated routes
  // with stricter role gates. Without this allowlist, any caller who passes
  // the ownership check below could still smuggle in those columns.
  const parsed = onboardingSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());

  // Ownership scope — mirrors the rules in `get`. CONSULTANT may edit only
  // their own row, RECRUITER only the consultants assigned to them, manager-
  // tier may edit anyone. Without this, the route's `requireRole(...ALL_ROLES)`
  // gate would let any signed-in user mutate any consultant by id.
  const { data: row, error: lookupErr } = await db
    .from('consultants')
    .select('id, user_id, recruiter_id')
    .eq('id', req.params.id)
    .maybeSingle();
  if (lookupErr) throw httpError(500, lookupErr.message);
  if (!row) throw httpError(404, 'Not found');

  // Admin tier unscoped; group leads confined to their group; recruiter to
  // their assigned consultants; consultant to their own row.
  if (isAdminTier(req.user.role)) {
    // unscoped
  } else if (isGroupLead(req.user.role)) {
    if (!(await leadCanAccessUser(req.user, (row as { user_id: string }).user_id))) {
      throw httpError(403, 'Forbidden');
    }
  } else if (req.user.role === 'RECRUITER') {
    const myRecId = await getCallerRecruiterRowId(req.user.id);
    if (!myRecId || (row as { recruiter_id: string | null }).recruiter_id !== myRecId) {
      throw httpError(403, 'Forbidden');
    }
  } else if (req.user.role === 'CONSULTANT') {
    if ((row as { user_id: string }).user_id !== req.user.id) throw httpError(403, 'Forbidden');
  } else {
    throw httpError(403, 'Forbidden');
  }

  const { data, error } = await db
    .from('consultants')
    .update(parsed.data)
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) throw httpError(500, 'Database error');
  res.json(data);
};

export const assignRecruiter: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const recruiter_id = req.body?.recruiter_id;
  if (!recruiter_id) throw httpError(400, 'recruiter_id required');

  // Verify the consultant exists and capture the current recruiter for cache invalidation.
  const { data: cons } = await db
    .from('consultants')
    .select('id, user_id, recruiter_id')
    .eq('id', req.params.id)
    .maybeSingle();
  if (!cons) throw httpError(404, 'Consultant not found');
  const oldCons = cons as { id: string; user_id: string | null; recruiter_id: string | null };

  // Verify the target recruiter_id points to a real recruiter row.
  const { data: rec } = await db
    .from('recruiters')
    .select('id, user_id')
    .eq('id', recruiter_id)
    .maybeSingle();
  if (!rec) throw httpError(400, 'Recruiter not found');
  const newRec = rec as { id: string; user_id: string | null };

  const { data, error } = await db
    .from('consultants')
    .update({ recruiter_id })
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) throw httpError(500, 'Database error');

  // Invalidate permission caches for old recruiter, new recruiter, and the consultant.
  if (oldCons.recruiter_id) {
    const { data: oldRec } = await db
      .from('recruiters')
      .select('user_id')
      .eq('id', oldCons.recruiter_id)
      .maybeSingle();
    if (oldRec?.user_id) invalidatePermissionCache(oldRec.user_id as string);
  }
  if (newRec.user_id) invalidatePermissionCache(newRec.user_id);
  if (oldCons.user_id) invalidatePermissionCache(oldCons.user_id);

  await audit({
    action: 'consultant_recruiter_assigned',
    user_id: req.user.id,
    req,
    metadata: {
      consultant_id: req.params.id,
      old_recruiter_id: oldCons.recruiter_id,
      new_recruiter_id: recruiter_id,
    },
  });

  res.json(data);
};

export const setMarketingStatus: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const schema = z.object({ marketing_status: z.enum(['ACTIVE', 'PAUSED', 'PLACED']) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid status');

  // Non-manager callers (recruiters) can only update their own consultants.
  if (!isManagerTier(req.user.role)) {
    const myRecId = await getCallerRecruiterRowId(req.user.id);
    const { data: cons } = await db
      .from('consultants')
      .select('recruiter_id')
      .eq('id', req.params.id)
      .maybeSingle();
    if (!cons || (cons as { recruiter_id: string | null }).recruiter_id !== myRecId)
      throw httpError(404, 'Not found');
  }

  const { data, error } = await db
    .from('consultants')
    .update({ marketing_status: parsed.data.marketing_status })
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) throw httpError(500, 'Database error');
  res.json(data);
};
