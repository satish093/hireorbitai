import { RequestHandler } from 'express';
import { z } from 'zod';
import { db } from '../config/db';
import { httpError, MANAGER_TIER } from '../types';
import { syncInterviewReminders } from '../services/interviewReminders.service';

// ---------------------------------------------------------------------------
// Authorization helpers — every signed-in user reaches these handlers, so
// each endpoint scopes by the caller's principal:
//   - MANAGER_TIER: full visibility / edit access.
//   - RECRUITER:   only interviews tied to consultants assigned to them.
//   - CONSULTANT:  only interviews tied to their own consultant row.
// ---------------------------------------------------------------------------

function isManagerTier(role?: string): boolean {
  return !!role && (MANAGER_TIER as string[]).includes(role);
}

async function getCallerRecruiterRowId(userId: string): Promise<string | null> {
  const { data } = await db.from('recruiters').select('id').eq('user_id', userId).maybeSingle();
  return (data as { id?: string } | null)?.id ?? null;
}

async function getCallerConsultantRowId(userId: string): Promise<string | null> {
  const { data } = await db.from('consultants').select('id').eq('user_id', userId).maybeSingle();
  return (data as { id?: string } | null)?.id ?? null;
}

interface InterviewOwnership {
  id: string;
  consultant_id: string | null;
  created_by: string | null;
}

async function loadAndAuthorize(
  caller: { id: string; role: string },
  interviewId: string,
): Promise<InterviewOwnership> {
  const { data, error } = await db
    .from('interviews')
    .select('id, consultant_id, created_by')
    .eq('id', interviewId)
    .maybeSingle();
  if (error) throw httpError(500, error.message);
  if (!data) throw httpError(404, 'Interview not found');
  const row = data as InterviewOwnership;

  if (isManagerTier(caller.role)) return row;

  // Anyone listed as the creator may keep editing their own row (e.g. a
  // recruiter who scheduled a peer's mock and needs to amend it).
  if (row.created_by === caller.id) return row;

  if (caller.role === 'RECRUITER' && row.consultant_id) {
    const myRecId = await getCallerRecruiterRowId(caller.id);
    if (myRecId) {
      const { data: cons } = await db
        .from('consultants')
        .select('id')
        .eq('id', row.consultant_id)
        .eq('recruiter_id', myRecId)
        .maybeSingle();
      if (cons) return row;
    }
  } else if (caller.role === 'CONSULTANT' && row.consultant_id) {
    const myConsId = await getCallerConsultantRowId(caller.id);
    if (myConsId === row.consultant_id) return row;
  }
  // 404 to avoid leaking existence.
  throw httpError(404, 'Interview not found');
}

/** Verify that the caller may schedule for the supplied consultant_id. */
async function authorizeCreateForConsultant(
  caller: { id: string; role: string },
  consultantId: string | undefined | null,
): Promise<void> {
  if (!consultantId) throw httpError(400, 'consultant_id is required');
  if (isManagerTier(caller.role)) return;
  if (caller.role === 'RECRUITER') {
    const myRecId = await getCallerRecruiterRowId(caller.id);
    if (!myRecId) throw httpError(403, 'Forbidden');
    const { data: cons } = await db
      .from('consultants')
      .select('id')
      .eq('id', consultantId)
      .eq('recruiter_id', myRecId)
      .maybeSingle();
    if (!cons) throw httpError(403, 'Forbidden');
  } else if (caller.role === 'CONSULTANT') {
    const myConsId = await getCallerConsultantRowId(caller.id);
    if (myConsId !== consultantId) throw httpError(403, 'Forbidden');
  } else {
    throw httpError(403, 'Forbidden');
  }
}

// Allowlist for create/schedule. created_by is server-set, consultant_id is
// authorized separately. type / status default safely if absent.
const scheduleSchema = z
  .object({
    consultant_id: z.string().uuid(),
    application_id: z.string().uuid().optional().nullable(),
    type: z.string().optional(),
    status: z.string().optional(),
    scheduled_at: z.string().datetime().optional().nullable(),
    duration_minutes: z
      .number()
      .int()
      .min(0)
      .max(24 * 60)
      .optional()
      .nullable(),
    interviewer: z.string().max(120).optional().nullable(),
    meeting_url: z.string().url().optional().nullable(),
    notes: z.string().optional().nullable(),
    is_mock: z.boolean().optional(),
  })
  .strict();

// Allowlist for PATCH /interviews/:id. Excludes created_by, consultant_id,
// application_id, is_mock, feedback_submitted_by — all of which would
// otherwise be mass-assignable.
const updateSchema = z
  .object({
    status: z.string().optional(),
    scheduled_at: z.string().datetime().optional().nullable(),
    duration_minutes: z
      .number()
      .int()
      .min(0)
      .max(24 * 60)
      .optional()
      .nullable(),
    interviewer: z.string().max(120).optional().nullable(),
    meeting_url: z.string().url().optional().nullable(),
    notes: z.string().optional().nullable(),
  })
  .strict();

const feedbackSchema = z.object({
  feedback: z
    .union([z.record(z.string(), z.any()), z.string()])
    .optional()
    .nullable(),
});

// ---------------------------------------------------------------------------
// GET /interviews — scoped list.
// ---------------------------------------------------------------------------
export const list: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const { consultant_id, from, to, is_mock } = req.query as Record<string, string | undefined>;
  let qb = db
    .from('interviews')
    .select('*, consultant:consultants(*), application:applications(*)');

  if (isManagerTier(req.user.role)) {
    if (consultant_id) qb = qb.eq('consultant_id', consultant_id);
  } else if (req.user.role === 'RECRUITER') {
    const myRecId = await getCallerRecruiterRowId(req.user.id);
    if (!myRecId) {
      res.json([]);
      return;
    }
    // Pull the recruiter's consultant ids and filter.
    const { data: cons } = await db.from('consultants').select('id').eq('recruiter_id', myRecId);
    const ids = ((cons ?? []) as { id: string }[]).map((c) => c.id);
    if (ids.length === 0) {
      res.json([]);
      return;
    }
    qb = qb.in('consultant_id', ids);
    if (consultant_id && ids.includes(consultant_id)) qb = qb.eq('consultant_id', consultant_id);
  } else if (req.user.role === 'CONSULTANT') {
    const myConsId = await getCallerConsultantRowId(req.user.id);
    if (!myConsId) {
      res.json([]);
      return;
    }
    qb = qb.eq('consultant_id', myConsId);
  } else {
    res.json([]);
    return;
  }

  if (is_mock != null) qb = qb.eq('is_mock', is_mock === 'true');
  if (from) qb = qb.gte('scheduled_at', from);
  if (to) qb = qb.lte('scheduled_at', to);
  const { data, error } = await qb.order('scheduled_at', { ascending: true });
  if (error) throw httpError(500, error.message);
  res.json(data);
};

export const schedule: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const parsed = scheduleSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());
  await authorizeCreateForConsultant(req.user, parsed.data.consultant_id);

  const { data, error } = await db
    .from('interviews')
    .insert({ ...parsed.data, created_by: req.user.id })
    .select()
    .single();
  if (error) throw httpError(500, error.message);
  await syncInterviewReminders(data as Parameters<typeof syncInterviewReminders>[0]);
  res.status(201).json(data);
};

export const scheduleMock: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const parsed = scheduleSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());
  await authorizeCreateForConsultant(req.user, parsed.data.consultant_id);

  const { data, error } = await db
    .from('interviews')
    .insert({ ...parsed.data, type: 'MOCK', is_mock: true, created_by: req.user.id })
    .select()
    .single();
  if (error) throw httpError(500, error.message);
  await syncInterviewReminders(data as Parameters<typeof syncInterviewReminders>[0]);
  res.status(201).json(data);
};

export const update: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  await loadAndAuthorize(req.user, req.params.id);
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());

  const { data, error } = await db
    .from('interviews')
    .update(parsed.data)
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) throw httpError(500, error.message);
  // Reschedule / cancel: regenerate the lead-time reminders for the new
  // date (or clear them if the interview is no longer SCHEDULED).
  await syncInterviewReminders(data as Parameters<typeof syncInterviewReminders>[0]);
  res.json(data);
};

export const submitFeedback: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  await loadAndAuthorize(req.user, req.params.id);
  const parsed = feedbackSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());

  // If `feedback` field isn't supplied, fall back to the whole body for the
  // legacy callers that just POST the JSON object directly. We never accept
  // `feedback_submitted_by` from the client — always set it server-side.
  const feedback = parsed.data.feedback ?? req.body ?? null;
  const { data, error } = await db
    .from('interviews')
    .update({
      feedback,
      feedback_submitted_at: new Date().toISOString(),
      feedback_submitted_by: req.user.id,
      status: 'COMPLETED',
    })
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) throw httpError(500, error.message);
  res.json(data);
};
