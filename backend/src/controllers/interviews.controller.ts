import { RequestHandler } from 'express';
import { z } from 'zod';
import { db } from '../config/db';
import { httpError, MANAGER_TIER, type Role } from '../types';
import {
  managerGroupConsultantIds,
  isAdminTier,
  isGroupLead,
  leadCanAccessConsultant,
} from '../services/groupScope';
import { syncInterviewReminders } from '../services/interviewReminders.service';
import { publishToUser } from '../services/realtime.service';

/**
 * Best-effort realtime push for an interview mutation. Notifies the actor (so
 * their other open tabs sync) and the interview's consultant (so the person it
 * concerns sees it live). Managers aren't fanned out — they refetch on
 * navigation / the `interviews` invalidate channel. Never throws: a failed
 * publish must not fail the mutation.
 */
async function publishInterviewChange(
  row: {
    id?: string;
    consultant_id?: string | null;
    scheduled_at?: string | null;
    status?: string | null;
  },
  actorId: string,
): Promise<void> {
  try {
    const recipients = new Set<string>();
    if (actorId) recipients.add(actorId);
    if (row.consultant_id) {
      const { data } = await db
        .from('consultants')
        .select('user_id')
        .eq('id', row.consultant_id)
        .maybeSingle();
      const uid = (data as { user_id?: string } | null)?.user_id;
      if (uid) recipients.add(uid);
    }
    const payload = {
      id: row.id,
      scheduled_at: row.scheduled_at ?? null,
      status: row.status ?? null,
    };
    await Promise.all(
      [...recipients].map((uid) => publishToUser(uid, 'interview:changed', payload)),
    );
  } catch {
    /* best-effort */
  }
}

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
  caller: { id: string; role: Role; group_id?: string | null },
  interviewId: string,
): Promise<InterviewOwnership> {
  const { data, error } = await db
    .from('interviews')
    .select('id, consultant_id, created_by')
    .eq('id', interviewId)
    .maybeSingle();
  if (error) throw httpError(500, 'Database error');
  if (!data) throw httpError(404, 'Interview not found');
  const row = data as InterviewOwnership;

  // Admin tier is unscoped. Group leads (HR_MANAGER/MANAGER) may only touch
  // interviews for consultants in their own group.
  if (isAdminTier(caller.role)) return row;
  if (isGroupLead(caller.role)) {
    if (row.consultant_id && (await leadCanAccessConsultant(caller, row.consultant_id))) return row;
    throw httpError(404, 'Interview not found');
  }

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
  caller: { id: string; role: Role; group_id?: string | null },
  consultantId: string | undefined | null,
): Promise<void> {
  if (!consultantId) throw httpError(400, 'consultant_id is required');
  if (isAdminTier(caller.role)) return;
  if (isGroupLead(caller.role)) {
    if (await leadCanAccessConsultant(caller, consultantId)) return;
    throw httpError(403, 'Forbidden');
  }
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
// Scope resolution — mirrors the GET /interviews list visibility rules.
//
// Returns the set of consultant_ids the caller may see, or { all: true } for
// manager-tier callers (no consultant filter). `null` means the caller can see
// nothing (e.g. a recruiter with no consultants, or an unknown role) and the
// caller should short-circuit to an empty result.
// ---------------------------------------------------------------------------
type InterviewScope = { all: true } | { all: false; consultantIds: string[] } | null;

async function resolveInterviewScope(caller: {
  id: string;
  role: Role;
  group_id?: string | null;
}): Promise<InterviewScope> {
  // Admin tier sees everything. Group leads are scoped to their group's
  // consultants; a lead with no group (or empty group) sees nothing.
  if (isAdminTier(caller.role)) return { all: true };
  if (isGroupLead(caller.role)) {
    const ids = await managerGroupConsultantIds(caller);
    if (!ids || ids.length === 0) return null;
    return { all: false, consultantIds: ids };
  }
  if (caller.role === 'RECRUITER') {
    const myRecId = await getCallerRecruiterRowId(caller.id);
    if (!myRecId) return null;
    const { data: cons } = await db.from('consultants').select('id').eq('recruiter_id', myRecId);
    const ids = ((cons ?? []) as { id: string }[]).map((c) => c.id);
    if (ids.length === 0) return null;
    return { all: false, consultantIds: ids };
  }
  if (caller.role === 'CONSULTANT') {
    const myConsId = await getCallerConsultantRowId(caller.id);
    if (!myConsId) return null;
    return { all: false, consultantIds: [myConsId] };
  }
  return null;
}

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
    // A MANAGER only sees interviews for consultants in their own group.
    const groupConsultantIds = await managerGroupConsultantIds(req.user);
    if (groupConsultantIds !== null) {
      if (groupConsultantIds.length === 0) {
        res.json([]);
        return;
      }
      qb = qb.in('consultant_id', groupConsultantIds);
    }
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
  if (error) throw httpError(500, 'Database error');
  // Strip internal recruiter/manager feedback from consultant-facing responses.
  if (req.user.role === 'CONSULTANT') {
    const rows = ((data ?? []) as Record<string, unknown>[]).map(
      ({ feedback: _f, feedback_submitted_by: _fsb, feedback_submitted_at: _fsa, ...rest }) => rest,
    );
    res.json(rows);
    return;
  }
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
  if (error) throw httpError(500, 'Database error');
  await syncInterviewReminders(data as Parameters<typeof syncInterviewReminders>[0]);
  await publishInterviewChange(data as Record<string, unknown>, req.user.id);
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
  if (error) throw httpError(500, 'Database error');
  await syncInterviewReminders(data as Parameters<typeof syncInterviewReminders>[0]);
  await publishInterviewChange(data as Record<string, unknown>, req.user.id);
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
  if (error) throw httpError(500, 'Database error');
  // Reschedule / cancel: regenerate the lead-time reminders for the new
  // date (or clear them if the interview is no longer SCHEDULED).
  await syncInterviewReminders(data as Parameters<typeof syncInterviewReminders>[0]);
  await publishInterviewChange(data as Record<string, unknown>, req.user.id);
  res.json(data);
};

// ---------------------------------------------------------------------------
// GET /interviews/conflicts?from=&to= — overlapping interview pairs in the
// window, scoped to what the caller may see (same rules as the list).
// ---------------------------------------------------------------------------
interface ConflictRow {
  id: string;
  title: string;
  start_at: string;
  duration_min: number;
}

const conflictsQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export const conflicts: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const parsed = conflictsQuerySchema.safeParse(req.query);
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());
  const { from, to } = parsed.data;

  const scope = await resolveInterviewScope(req.user);
  if (!scope) {
    res.json([]);
    return;
  }

  let qb = db
    .from('interviews')
    .select('id, type, scheduled_at, duration_minutes')
    .not('scheduled_at', 'is', null);
  if (!scope.all) qb = qb.in('consultant_id', scope.consultantIds);
  if (from) qb = qb.gte('scheduled_at', from);
  if (to) qb = qb.lte('scheduled_at', to);

  const { data, error } = await qb.order('scheduled_at', { ascending: true });
  if (error) throw httpError(500, 'Database error');

  type Raw = {
    id: string;
    type: string | null;
    scheduled_at: string;
    duration_minutes: number | null;
  };
  const events: ConflictRow[] = ((data ?? []) as Raw[]).map((r) => ({
    id: r.id,
    title: r.type ?? 'Interview',
    start_at: r.scheduled_at,
    duration_min: r.duration_minutes ?? 60,
  }));

  // Sweep-line: events are already sorted by start. Keep a list of "active"
  // events whose interval [start, start+duration) overlaps the current one;
  // every active event that hasn't ended before the current event begins is a
  // conflict. O(n log n) overall (sort) + O(k) per overlap emitted.
  const startMs = (e: ConflictRow) => new Date(e.start_at).getTime();
  const endMs = (e: ConflictRow) => startMs(e) + Math.max(0, e.duration_min) * 60_000;

  const result: { a: ConflictRow; b: ConflictRow }[] = [];
  const active: ConflictRow[] = [];
  for (const ev of events) {
    const evStart = startMs(ev);
    // Drop any active event that has already ended (no overlap possible).
    for (let i = active.length - 1; i >= 0; i--) {
      if (endMs(active[i]) <= evStart) active.splice(i, 1);
    }
    // Whatever remains active overlaps `ev` (their end > ev.start, and they
    // started at or before ev.start since we iterate in start order).
    for (const a of active) result.push({ a, b: ev });
    active.push(ev);
  }

  res.json(result);
};

// ---------------------------------------------------------------------------
// GET /interviews/next?for=<user_id> — nearest upcoming interview relevant to
// the target user. If `for` differs from the caller and the caller is not
// manager-tier, `for` is ignored and the caller's own scope is used.
// ---------------------------------------------------------------------------
const nextQuerySchema = z.object({ for: z.string().uuid().optional() });

export const next: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const parsed = nextQuerySchema.safeParse(req.query);
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());

  // Decide whose interviews to look at. Non-managers can never target another
  // user; their request is silently scoped back to themselves.
  let targetUserId = req.user.id;
  if (parsed.data.for && isManagerTier(req.user.role)) {
    targetUserId = parsed.data.for;
  }

  // Resolve the target user's consultant scope. We use the consultant row to
  // find their interviews; managers querying a non-consultant user simply get
  // their created interviews. The caller is already constrained to
  // manager-tier when targeting someone else, so this can't leak across
  // non-manager principals.
  const targetConsId = await getCallerConsultantRowId(targetUserId);

  let qb = db
    .from('interviews')
    .select('*, consultant:consultants(*), application:applications(*)')
    .gt('scheduled_at', new Date().toISOString());

  if (targetConsId) {
    qb = qb.eq('consultant_id', targetConsId);
  } else {
    // No consultant row for the target. Fall back to interviews the target
    // created (e.g. a recruiter/manager who scheduled mocks).
    qb = qb.eq('created_by', targetUserId);
  }

  const { data, error } = await qb.order('scheduled_at', { ascending: true }).limit(1);
  if (error) throw httpError(500, 'Database error');
  const rows = (data ?? []) as Record<string, unknown>[];
  if (rows.length === 0) {
    res.json(null);
    return;
  }
  if (req.user.role === 'CONSULTANT') {
    const {
      feedback: _f,
      feedback_submitted_by: _fsb,
      feedback_submitted_at: _fsa,
      ...safe
    } = rows[0];
    res.json(safe);
    return;
  }
  res.json(rows[0]);
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
  if (error) throw httpError(500, 'Database error');
  await publishInterviewChange(data as Record<string, unknown>, req.user.id);
  res.json(data);
};
