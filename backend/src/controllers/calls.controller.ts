import { RequestHandler } from 'express';
import { z } from 'zod';
import { db, pool } from '../config/db';
import { httpError } from '../types';
import { canMessageUser } from '../services/permission.service';
import { publishToUser } from '../services/realtime.service';
import { audit } from '../services/audit.service';
import { logger } from '../config/logger';
import { env } from '../config/env';

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
  // Same multi-tab clearance as answer() — every other live SSE stream of
  // the rejecting user gets a notice so the ringtone/vibration stops.
  await publishToUser(me.id, 'call:rejected-elsewhere', { call_id });

  logger.info({ call_id, callee_id: me.id }, 'call:rejected');

  res.json({ ok: true });
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
