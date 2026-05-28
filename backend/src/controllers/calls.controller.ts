import { RequestHandler } from 'express';
import { z } from 'zod';
import { db, pool } from '../config/db';
import { httpError } from '../types';
import { canMessageUser } from '../services/permission.service';
import { publishToUser } from '../services/realtime.service';
import { logger } from '../config/logger';

// ---------------------------------------------------------------------------
// Schema helpers
// ---------------------------------------------------------------------------

// Voice-only by policy. Video has been stripped from the frontend; rejecting
// it at the schema closes the gap where a crafted client could persist a
// `video` row that downstream code (history, audit) wouldn't know how to
// render. When/if video lands, widen to `z.enum(['audio', 'video'])`.
const offerSchema = z.object({
  callee_id: z.string().uuid(),
  call_type: z.literal('audio'),
  sdp: z.string().min(1),
});

const answerSchema = z.object({
  call_id: z.string().uuid(),
  caller_id: z.string().uuid(),
  sdp: z.string().min(1),
});

const iceCandidateSchema = z.object({
  call_id: z.string().uuid(),
  peer_id: z.string().uuid(),
  candidate: z.object({
    candidate: z.string(),
    sdpMid: z.string().nullable().optional(),
    sdpMLineIndex: z.number().nullable().optional(),
  }),
});

const endSchema = z.object({
  call_id: z.string().uuid(),
  peer_id: z.string().uuid(),
});

const rejectSchema = z.object({
  call_id: z.string().uuid(),
  caller_id: z.string().uuid(),
});

// ---------------------------------------------------------------------------
// POST /calls/offer  — caller initiates, backend notifies callee
// ---------------------------------------------------------------------------

export const offer: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const me = req.user;

  const parsed = offerSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid request', parsed.error.flatten());

  const { callee_id, call_type, sdp } = parsed.data;

  // Permission check BEFORE any DB write.
  const allowed = await canMessageUser(
    { id: me.id, role: me.role, group_id: me.group_id ?? null },
    callee_id,
  );
  if (!allowed) throw httpError(403, 'Not permitted to call this user');

  // Fetch caller display info first so it's ready before we notify the callee.
  const { data: callerRow } = await db
    .from('users')
    .select('id, full_name, email, role')
    .eq('id', me.id)
    .maybeSingle();

  // Persist the call record.
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO public.calls (caller_id, callee_id, call_type, status)
     VALUES ($1, $2, $3, 'ringing')
     RETURNING id`,
    [me.id, callee_id, call_type],
  );
  const call_id = rows[0]!.id;

  // Push call:incoming to callee via the existing SSE channel.
  await publishToUser(callee_id, 'call:incoming', {
    call_id,
    call_type,
    sdp,
    caller: callerRow ?? { id: me.id, email: me.email, role: me.role },
  });

  logger.info({ caller_id: me.id, callee_id, call_type, call_id }, 'call:offer initiated');

  res.json({ call_id });
};

// ---------------------------------------------------------------------------
// POST /calls/answer  — callee accepts, backend sends answer SDP to caller
// ---------------------------------------------------------------------------

export const answer: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const me = req.user;

  const parsed = answerSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid request', parsed.error.flatten());

  const { call_id, caller_id, sdp } = parsed.data;

  // Atomic: update only if status is still 'ringing' AND callee matches me.
  // Prevents double-answer race and validates ownership in one query.
  const { rows } = await pool.query<{ caller_id: string }>(
    `UPDATE public.calls
     SET status = 'accepted', started_at = now()
     WHERE id = $1 AND callee_id = $2 AND status = 'ringing'
     RETURNING caller_id`,
    [call_id, me.id],
  );
  if (!rows[0]) throw httpError(409, 'Call not available (already ended or not yours)');

  // Validate client-supplied caller_id matches the actual record.
  if (rows[0].caller_id !== caller_id) throw httpError(409, 'Caller ID mismatch');

  await publishToUser(caller_id, 'call:answered', { call_id, sdp });

  logger.info({ call_id, caller_id, callee_id: me.id }, 'call:answered');

  res.json({ ok: true });
};

// ---------------------------------------------------------------------------
// POST /calls/ice-candidate  — relay ICE candidate to peer
// ---------------------------------------------------------------------------

export const iceCandidate: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const me = req.user;

  const parsed = iceCandidateSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid request', parsed.error.flatten());

  const { call_id, peer_id, candidate } = parsed.data;

  // Verify sender is a participant and peer_id is the OTHER party.
  const { rows } = await pool.query<{ caller_id: string; callee_id: string }>(
    `SELECT caller_id, callee_id FROM public.calls WHERE id = $1 LIMIT 1`,
    [call_id],
  );
  if (!rows[0]) throw httpError(404, 'Call not found');

  const { caller_id, callee_id } = rows[0];
  if (me.id !== caller_id && me.id !== callee_id) throw httpError(403, 'Not part of this call');
  if (peer_id !== caller_id && peer_id !== callee_id) throw httpError(403, 'Invalid peer');
  if (peer_id === me.id) throw httpError(400, 'Cannot send ICE candidate to self');

  await publishToUser(peer_id, 'call:ice-candidate', { call_id, candidate });

  res.json({ ok: true });
};

// ---------------------------------------------------------------------------
// POST /calls/end  — either party hangs up
// ---------------------------------------------------------------------------

export const end: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const me = req.user;

  const parsed = endSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid request', parsed.error.flatten());

  const { call_id, peer_id } = parsed.data;

  const { rows } = await pool.query<{ caller_id: string; callee_id: string }>(
    `UPDATE public.calls
     SET status = 'ended', ended_at = now()
     WHERE id = $1
       AND status NOT IN ('ended', 'rejected')
       AND (caller_id = $2 OR callee_id = $2)
     RETURNING caller_id, callee_id`,
    [call_id, me.id],
  );
  if (!rows[0]) throw httpError(404, 'Call not found or already ended');

  const { caller_id, callee_id } = rows[0];
  if (peer_id !== caller_id && peer_id !== callee_id) throw httpError(403, 'Invalid peer');
  if (peer_id === me.id) throw httpError(400, 'Cannot send call end to self');

  await publishToUser(peer_id, 'call:ended', { call_id });

  logger.info({ call_id, ended_by: me.id }, 'call:ended');

  res.json({ ok: true });
};

// ---------------------------------------------------------------------------
// POST /calls/reject  — callee declines incoming call
// ---------------------------------------------------------------------------

export const reject: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const me = req.user;

  const parsed = rejectSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid request', parsed.error.flatten());

  const { call_id, caller_id } = parsed.data;

  // Atomic: only reject if callee is me and call is still ringing.
  const { rows } = await pool.query<{ caller_id: string }>(
    `UPDATE public.calls
     SET status = 'rejected', ended_at = now()
     WHERE id = $1 AND callee_id = $2 AND status = 'ringing'
     RETURNING caller_id`,
    [call_id, me.id],
  );
  if (!rows[0]) throw httpError(409, 'Call not available (already ended or not yours)');
  if (rows[0].caller_id !== caller_id) throw httpError(409, 'Caller ID mismatch');

  await publishToUser(caller_id, 'call:rejected', { call_id });

  logger.info({ call_id, callee_id: me.id }, 'call:rejected');

  res.json({ ok: true });
};
