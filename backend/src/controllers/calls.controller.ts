import { RequestHandler } from 'express';
import { z } from 'zod';
import { db, pool } from '../config/db';
import { httpError } from '../types';
import { canMessageUser } from '../services/permission.service';
import { publishToUser } from '../services/realtime.service';
import { audit } from '../services/audit.service';
import { logger } from '../config/logger';
import { env } from '../config/env';
import {
  assertUnderMonthlyCap,
  getMonthlyHoursUsed,
  invalidateMonthlyHoursUsed,
} from '../services/callsBudget.service';

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
  if (!allowed) {
    // Surface denied call attempts in the audit trail so abuse / probing of
    // the messaging-permission boundary is visible alongside the existing
    // `messages_permission_denied` events.
    audit({
      action: 'calls_permission_denied',
      user_id: me.id,
      email: me.email,
      req,
      metadata: { callee_id, call_type },
    });
    throw httpError(403, 'Not permitted to call this user');
  }

  // Org-wide monthly cap. Refuses NEW offers once accepted-call duration
  // for the calendar month hits CALLS_MONTHLY_HOUR_CAP (default 980 hrs)
  // — protects the Cloudflare Realtime TURN free tier. Calls already in
  // progress are not affected; only new offers get a 503. The check is
  // cached for ~60 s so it's effectively free on the hot path.
  try {
    await assertUnderMonthlyCap();
  } catch (err) {
    if (err instanceof Error && (err as { status?: number }).status === 503) {
      // Greppable audit row carrying the actual numbers (cap + used) so
      // post-incident analysis can correlate the spike with when the
      // service started refusing. Same `audit({...})` pattern as the
      // permission-denied event above.
      const used = await getMonthlyHoursUsed().catch(() => -1);
      audit({
        action: 'calls_monthly_cap_reached',
        user_id: me.id,
        email: me.email,
        req,
        metadata: {
          callee_id,
          used_hours: used,
          cap_hours: env.calls.monthlyHourCap,
        },
      });
    }
    throw err;
  }

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
  // Fan out a 'taken-on-another-tab' notice to the callee's OTHER live SSE
  // streams (laptop + phone + stale tabs). Without this, every other tab
  // keeps ringing + vibrating forever — the phone-in-meeting bug. The
  // active tab guards on call_id and ignores its own notice.
  await publishToUser(me.id, 'call:accepted-elsewhere', { call_id });

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

  // Atomic close-out. Computes duration_seconds in the same statement so
  // we never have a window where the row is `status='ended'` but missing
  // the duration. GREATEST(0, …) defends against pathological cases
  // where ended_at could land before started_at (e.g. clock drift during
  // an immediate end). Calls that were never accepted (started_at IS
  // NULL — typical for caller-cancel before pickup) get NULL duration,
  // which the monthly-cap aggregation already excludes.
  const { rows } = await pool.query<{ caller_id: string; callee_id: string }>(
    `UPDATE public.calls
     SET status = 'ended',
         ended_at = now(),
         duration_seconds = CASE
           WHEN started_at IS NULL THEN NULL
           ELSE GREATEST(0, EXTRACT(EPOCH FROM (now() - started_at))::int)
         END
     WHERE id = $1
       AND status NOT IN ('ended', 'rejected')
       AND (caller_id = $2 OR callee_id = $2)
     RETURNING caller_id, callee_id`,
    [call_id, me.id],
  );
  if (!rows[0]) throw httpError(404, 'Call not found or already ended');

  // Wipe the budget cache so the next /calls/offer sees this call's
  // duration immediately. Without this, the cap check could lag by up
  // to the 60 s cache TTL — usually fine, but means a back-to-back
  // burst right at the cap boundary could over-shoot.
  invalidateMonthlyHoursUsed();

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
  // Same multi-tab clearance as answer() — every other live SSE stream of
  // the rejecting user gets a notice so the ringtone/vibration stops.
  await publishToUser(me.id, 'call:rejected-elsewhere', { call_id });

  logger.info({ call_id, callee_id: me.id }, 'call:rejected');

  res.json({ ok: true });
};

// ---------------------------------------------------------------------------
// GET /calls/history — recent calls for the current user (optionally with a peer)
// ---------------------------------------------------------------------------
//
// Surfaces the call log shown in the messaging context panel + mobile Calls
// tab. Returns each call from the CALLER-OR-CALLEE perspective of the viewer:
//   - direction: 'in' | 'out' relative to the viewer
//   - outcome:   'completed' | 'missed' | 'declined'  (missed = never accepted)
//   - peer:      the OTHER party's id + name + email + role
//   - duration_seconds, started_at, ended_at
//
// Scope is inherently self — a user only sees calls they participated in, so no
// extra permission gate beyond the MESSAGING_ROLES + feature gate on the
// router. `peer_id` narrows to a single conversation (used by the context
// panel); without it the endpoint returns the viewer's whole recent log.
export const history: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const me = req.user;

  const peerId = typeof req.query.peer_id === 'string' ? req.query.peer_id : null;
  const limit = Math.min(Number(req.query.limit) || 30, 100);

  const params: unknown[] = [me.id];
  let peerClause = '';
  if (peerId) {
    params.push(peerId);
    peerClause = `AND (c.caller_id = $2 OR c.callee_id = $2)`;
  }

  const { rows } = await pool.query<{
    id: string;
    caller_id: string;
    callee_id: string;
    status: string;
    started_at: string | null;
    ended_at: string | null;
    duration_seconds: number | null;
    peer_id: string;
    peer_name: string | null;
    peer_email: string;
    peer_role: string | null;
  }>(
    `SELECT c.id, c.caller_id, c.callee_id, c.status, c.started_at, c.ended_at,
            c.duration_seconds,
            u.id AS peer_id, u.full_name AS peer_name, u.email AS peer_email, u.role AS peer_role
       FROM public.calls c
       JOIN public.users u
         ON u.id = CASE WHEN c.caller_id = $1 THEN c.callee_id ELSE c.caller_id END
      WHERE (c.caller_id = $1 OR c.callee_id = $1)
        ${peerClause}
      ORDER BY COALESCE(c.ended_at, c.started_at, c.created_at) DESC
      LIMIT ${limit}`,
    params,
  );

  const result = rows.map((r) => {
    const direction = r.caller_id === me.id ? 'out' : 'in';
    // missed = never accepted (no started_at) and not an explicit decline;
    // declined = callee rejected; completed = had a live leg.
    const outcome =
      r.status === 'rejected' ? 'declined' : r.started_at == null ? 'missed' : 'completed';
    return {
      id: r.id,
      direction,
      outcome,
      duration_seconds: r.duration_seconds,
      started_at: r.started_at,
      ended_at: r.ended_at,
      peer: {
        id: r.peer_id,
        full_name: r.peer_name,
        email: r.peer_email,
        role: r.peer_role,
      },
    };
  });

  res.json(result);
};

// ---------------------------------------------------------------------------
// GET /calls/usage — monthly call-hour budget snapshot
// ---------------------------------------------------------------------------
//
// Read-only dashboard endpoint surfacing the same number the cap gate uses
// (env.calls.monthlyHourCap vs the cached SUM of duration_seconds in the
// current UTC calendar month). Gated by OWNER_TIER + the `calls_usage`
// developer capability in the route — anyone who can see the page also has
// permission to see the org-wide spend.
//
// Returns enough to render a single card without further math on the client:
//   - used_hours   — float, current month so far
//   - cap_hours    — env.calls.monthlyHourCap (0 means disabled)
//   - percent_used — clamped 0..100, null when cap=0
//   - cap_reached  — boolean, true when used_hours >= cap_hours
//   - reset_at_utc — ISO timestamp for 00:00 UTC on the 1st of next month

export const usage: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const usedHours = await getMonthlyHoursUsed();
  const capHours = env.calls.monthlyHourCap;
  const capActive = capHours > 0;
  // First day of next UTC month at 00:00:00 — the moment the cache key
  // flips (YYYY-MM rolls over) and counters effectively reset to 0.
  const now = new Date();
  const resetAt = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0),
  ).toISOString();
  res.json({
    used_hours: Math.round(usedHours * 100) / 100, // 2dp
    cap_hours: capHours,
    cap_active: capActive,
    percent_used: capActive
      ? Math.max(0, Math.min(100, Math.round((usedHours / capHours) * 100 * 10) / 10))
      : null,
    cap_reached: capActive && usedHours >= capHours,
    reset_at_utc: resetAt,
  });
};

// ---------------------------------------------------------------------------
// GET /calls/turn-credentials — mint short-lived ICE servers for the client
// ---------------------------------------------------------------------------
//
// The previous useCall.ts shipped with free OpenRelay TURN baked into the
// frontend bundle (single US region, shared with thousands of strangers,
// throttled). The new flow: the client asks the backend for a fresh
// iceServers array right before opening a call, and the backend stitches
// together up to three sources:
//
//   1. Cloudflare Realtime TURN (primary) — anycast across hundreds of POPs,
//      so a US peer relays through the closest US edge and an India peer
//      relays through the closest India edge. 1,000 GB/month free.
//      Credentials are ephemeral (TTL configurable, capped 24h) and minted
//      server-side so the bearer token never reaches the browser.
//
//   2. Metered.ca free TURN (fallback) — static creds, ~15 GB/month. Used
//      only if the browser fails to bind via the Cloudflare entry, which is
//      rare but happens behind some corporate firewalls.
//
//   3. Google STUN (always last) — for the happy path where peers can talk
//      directly (same-WiFi, modern home routers). Free, no creds.
//
// Every block is optional: if Cloudflare creds aren't configured the
// endpoint still returns Metered + STUN; if neither TURN provider is
// configured it returns STUN-only. That keeps dev/test running without
// any external dependency.
//
// Endpoint is gated by the same MESSAGING_ROLES + requireFeature('messages')
// the rest of /calls/* sits behind (see routes/index.ts). No body — auth
// alone identifies who the credentials are for.

interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

/** Cloudflare Realtime: POST a TTL → get { iceServers: { urls, username, credential } }. */
async function fetchCloudflareIceServers(reqLog: {
  warn: (...a: unknown[]) => void;
}): Promise<IceServer | null> {
  const { keyId, token } = env.turn.cloudflare;
  if (!keyId || !token) return null;
  try {
    // Cloudflare Realtime TURN credential issuance:
    //   POST https://rtc.live.cloudflare.com/v1/turn/keys/{keyId}/credentials/generate
    //   body: { ttl: <seconds> }
    // Response shape (per Cloudflare Realtime docs):
    //   { iceServers: { urls: string|string[], username, credential } }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const resp = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ttl: env.turn.credentialTtlSeconds }),
        signal: ctrl.signal,
      },
    );
    clearTimeout(timer);
    if (!resp.ok) {
      reqLog.warn(
        { status: resp.status },
        'turn-credentials: Cloudflare credential generation failed',
      );
      return null;
    }
    const data = (await resp.json()) as { iceServers?: IceServer };
    if (!data?.iceServers?.urls) return null;
    return data.iceServers;
  } catch (err) {
    reqLog.warn({ err: (err as Error).message }, 'turn-credentials: Cloudflare fetch errored');
    return null;
  }
}

export const turnCredentials: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');

  const reqLog = (req as unknown as { log?: { warn: (...a: unknown[]) => void } }).log ?? logger;
  const iceServers: IceServer[] = [];

  // 1. Cloudflare (primary). May return null if not configured or the API
  // call failed — we degrade silently to the fallback chain in either case.
  const cf = await fetchCloudflareIceServers(reqLog);
  if (cf) iceServers.push(cf);

  // 2. Metered.ca free (fallback). Static creds, multiple URLs (UDP/TCP on
  // 80 + 443) so the client gets the broadest port coverage.
  const { username, credential, urls } = env.turn.metered;
  if (username && credential && urls.length > 0) {
    iceServers.push({ urls, username, credential });
  }

  // 3. Google STUN (always last). Free, no creds. Lets peers with non-NATed
  // public IPs (rare on home networks, more common in datacenters) skip
  // TURN entirely.
  iceServers.push({ urls: 'stun:stun.l.google.com:19302' });
  iceServers.push({ urls: 'stun:stun1.l.google.com:19302' });

  // Short-cache hint. Browsers don't honor it for fetch() responses by
  // default but it's good documentation; the frontend already refetches
  // before every call start so caching beyond the TTL would only matter
  // for replay-style attacks (creds are scoped to the user anyway).
  res.set(
    'Cache-Control',
    `private, max-age=${Math.max(60, Math.floor(env.turn.credentialTtlSeconds / 2))}`,
  );
  res.json({
    iceServers,
    ttl_seconds: env.turn.credentialTtlSeconds,
    providers: {
      cloudflare: cf !== null,
      metered: !!(username && credential && urls.length > 0),
    },
  });
};
