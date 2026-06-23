import { RequestHandler } from 'express';
import { db } from '../config/db';
import { env } from '../config/env';
import { httpError, Role, DeveloperCapability, isPageAccessCapability } from '../types';

// Light-weight presence heartbeat. We bump last_seen_at at most once every
// HEARTBEAT_MIN_MS per user so we don't write to Postgres on every API call —
// activity within ~30s already counts as "online" downstream.
const HEARTBEAT_MIN_MS = 30_000;
/** Seconds credited per heartbeat tick — matches the cadence above so each
 *  observed beat represents one active 30-second window. */
const HEARTBEAT_SECONDS = 30;
const lastHeartbeat = new Map<string, number>();

function heartbeat(userId: string) {
  const now = Date.now();
  const last = lastHeartbeat.get(userId) ?? 0;
  if (now - last < HEARTBEAT_MIN_MS) return;
  const isFirstBeat = last === 0;
  lastHeartbeat.set(userId, now);

  // Fire-and-forget the last_seen_at write — never block the request.
  db.from('users')
    .update({ last_seen_at: new Date(now).toISOString() })
    .eq('id', userId)
    .then(
      () => {},
      () => {},
    );

  // Accumulate active seconds for today. If the user_activity_daily table
  // doesn't exist yet, the error is swallowed silently — the app keeps
  // working until you run database/user-activity-tracking.sql.
  // We skip the very first beat per session so opening a tab for two seconds
  // doesn't get credited a full 30s.
  if (!isFirstBeat) {
    const today = new Date(now).toISOString().slice(0, 10); // YYYY-MM-DD
    void bumpActivity(userId, today, HEARTBEAT_SECONDS);
  }
}

async function bumpActivity(userId: string, isoDate: string, addSeconds: number): Promise<void> {
  try {
    // No native atomic "add" in PostgREST, so read-modify-write with upsert.
    // Two concurrent heartbeats from the same user are ~impossible (30s throttle).
    const { data } = await db
      .from('user_activity_daily')
      .select('active_seconds')
      .eq('user_id', userId)
      .eq('activity_date', isoDate)
      .maybeSingle();
    const next = (data?.active_seconds ?? 0) + addSeconds;
    await db.from('user_activity_daily').upsert(
      {
        user_id: userId,
        activity_date: isoDate,
        active_seconds: next,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,activity_date' },
    );
  } catch {
    /* table missing → migration pending */
  }
}

/**
 * Verifies the bearer JWT, then loads the user's role from
 * public.users. Attaches `req.user` for downstream handlers.
 */
export const requireAuth: RequestHandler = async (req, _res, next) => {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw httpError(401, 'Missing bearer token');

  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) throw httpError(401, 'Invalid or expired token');

  // Pull role + group_id + must_change_password + status. `must_change_password`
  // gates routes until the temp-password rotation; `status` blocks the user
  // entirely if they've been deactivated/suspended/banned.
  // Defensive fallback: older deployments might be missing the status column,
  // so we narrow the select on schema-cache errors.
  let { data: profile, error: pErr } = await db
    .from('users')
    .select('id, email, role, group_id, must_change_password, status, capabilities')
    .eq('id', data.user.id)
    .single();
  if (
    pErr &&
    /status|must_change_password|group_id|capabilities/.test(pErr.message) &&
    /schema cache|column/i.test(pErr.message)
  ) {
    ({ data: profile, error: pErr } = await db
      .from('users')
      .select('id, email, role')
      .eq('id', data.user.id)
      .single());
  }
  if (pErr || !profile) throw httpError(403, 'User profile not found');

  // Status gate. `active` = OK, anything else = refused. We surface a
  // specific status string so the frontend can show "Your account is
  // suspended" instead of a generic 403.
  const status = (profile as any).status as string | undefined;
  if (status && status !== 'active') {
    throw httpError(403, `Account is ${status}`, { status });
  }

  req.user = {
    id: profile.id,
    email: profile.email,
    role: profile.role as Role,
    group_id: (profile as any).group_id ?? null,
    must_change_password: !!(profile as any).must_change_password,
    capabilities: ((profile as any).capabilities ?? []) as DeveloperCapability[],
  };
  heartbeat(profile.id);
  next();
};

/**
 * RBAC — allow only the listed roles. Falls back to 403.
 *
 *   router.post('/admin-only', requireAuth, requireRole('SUPER_ADMIN', 'CEO'), handler);
 */
export const requireRole =
  (...allowed: Role[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.user) throw httpError(401, 'Not authenticated');
    if (!allowed.includes(req.user.role)) throw httpError(403, 'Forbidden — insufficient role');
    next();
  };

/**
 * True when the user holds the given capability grant.
 *   - PAGE_ACCESS capabilities, when defined, apply to ANY role.
 *   - DEVELOPER admin capabilities apply ONLY to a DEVELOPER account.
 */
export function hasCapability(
  user: { role: Role; capabilities?: DeveloperCapability[] } | undefined,
  cap: DeveloperCapability,
): boolean {
  if (!user || !(user.capabilities ?? []).includes(cap)) return false;
  return isPageAccessCapability(cap) || user.role === 'DEVELOPER';
}

/**
 * RBAC gate that also admits a DEVELOPER holding a specific capability.
 *
 * Drop-in replacement for `requireRole(...tier)` on any surface a DEVELOPER may
 * be granted: a caller passes if their role is in `tier` OR they are a
 * DEVELOPER with `cap` granted. DEVELOPER has NO tier membership, so without
 * the grant it is denied — fail-closed.
 *
 *   router.use('/admin/features', requireRoleOrCapability(OWNER_TIER, 'feature_flags'), …)
 */
export const requireRoleOrCapability =
  (tier: Role[], cap: DeveloperCapability): RequestHandler =>
  (req, _res, next) => {
    if (!req.user) throw httpError(401, 'Not authenticated');
    if (tier.includes(req.user.role)) return next();
    if (hasCapability(req.user, cap)) return next();
    throw httpError(403, 'Forbidden — insufficient role');
  };

/**
 * RBAC — admin tier: SUPER_ADMIN, CEO, CTO, DIRECTOR. Use this on any admin
 * surface (user management, audit logs, feature flags).
 */
export const ADMIN_ROLES: Role[] = ['SUPER_ADMIN', 'CEO', 'CTO', 'DIRECTOR'];
export const requireAdmin: RequestHandler = (req, _res, next) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  if (!ADMIN_ROLES.includes(req.user.role)) throw httpError(403, 'Admin role required');
  next();
};

/**
 * Block routes for users still on a temporary password. The only allowed
 * routes for a `must_change_password` user are:
 *   - GET  /api/auth/me
 *   - POST /api/auth/logout
 *   - POST /api/auth/change-password
 *
 * Mount this AFTER requireAuth, BEFORE any protected route handler. The
 * router does that globally — see routes/index.ts.
 */
export const blockIfMustChangePassword: RequestHandler = (req, _res, next) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  if (req.user.must_change_password) {
    throw httpError(403, 'Password change required. Set a new password to continue.');
  }
  next();
};

/**
 * Gate for development-only routes (role/user switching, the Super-Admin test
 * panel API). Returns 404 — not 403 — when dev tooling is off, so these
 * endpoints are completely invisible in production (no existence oracle).
 * `env.devTools` is itself force-disabled whenever NODE_ENV=production.
 */
export const requireDevTools: RequestHandler = (_req, _res, next) => {
  if (!env.devTools) throw httpError(404, 'Not found');
  next();
};
