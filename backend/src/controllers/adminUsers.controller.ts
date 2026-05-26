import { RequestHandler } from 'express';
import { z } from 'zod';
import { db, pool } from '../config/db';
import { httpError, ALL_ROLES, ADMIN_TIER, DEVELOPER_CAPABILITIES, Role } from '../types';
import { audit } from '../services/audit.service';
import { requestPasswordReset } from '../services/auth.service';
import { logger } from '../config/logger';

// Role-rank ladder. Used to refuse status / group / password-reset changes
// when the actor would otherwise be tampering with an equal- or higher-rank
// admin's account. Without this guard, a DIRECTOR could lock out the
// SUPER_ADMIN — and once the access token TTL elapses, the SUPER_ADMIN is
// permanently locked out unless another super-admin exists to reactivate
// them. The ladder mirrors shared/src/roles.ts ordering.
export const ROLE_RANK: Record<Role, number> = {
  SUPER_ADMIN: 100,
  CEO: 90,
  CTO: 80,
  DIRECTOR: 70,
  // HR_MANAGER sits ABOVE MANAGER: it oversees managers across all groups, so
  // it can act on a MANAGER while a MANAGER cannot act on it.
  HR_MANAGER: 65,
  MANAGER: 60,
  DEVELOPER: 50,
  RECRUITER: 40,
  CONSULTANT: 10,
};

/** Throws 403 if the actor is trying to mutate an equal- or higher-ranked
 *  user — admins below SUPER_ADMIN can never reach above their own tier. */
export function assertOutranks(actor: { role: Role }, targetRole: Role | null | undefined): void {
  if (!targetRole) return;
  const a = ROLE_RANK[actor.role] ?? 0;
  const t = ROLE_RANK[targetRole] ?? 0;
  if (t >= a) {
    throw httpError(403, `You cannot change a user with role ${targetRole}. Ask a SUPER_ADMIN.`);
  }
}

/** Throws 409 if removing this user (or making them inactive) would leave
 *  zero active SUPER_ADMINs in the org. Same guard the legacy
 *  `users.controller.deactivate` route uses — without it, the admin surface
 *  can lock the org out of its only super-admin. */
export async function assertNotLastSuperAdmin(targetId: string): Promise<void> {
  const { data: target } = await db
    .from('users')
    .select('role, is_active')
    .eq('id', targetId)
    .maybeSingle();
  if (!target) return; // 404 surfaces elsewhere
  const row = target as { role: Role; is_active: boolean };
  if (row.role !== 'SUPER_ADMIN' || row.is_active === false) return;
  const { count } = await db
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('role', 'SUPER_ADMIN')
    .eq('is_active', true);
  if ((count ?? 0) <= 1) {
    throw httpError(
      409,
      'Refusing to remove the last active SUPER_ADMIN. Promote another admin first.',
    );
  }
}

// ---------------------------------------------------------------------------
// Admin user-management surface (mounted at /admin/users).
//
// Every route here is protected by `requireAdmin` upstream — see
// routes/index.ts. Listing, status changes, and admin-triggered password
// resets all live here. The role-specific data ("Candidate has resume X")
// lives in the existing /users/:id endpoint and is reused for the detail
// view; this controller focuses on org-level admin actions.
// ---------------------------------------------------------------------------

const STATUSES = ['active', 'inactive', 'suspended', 'pending_verification', 'banned'] as const;

// ---------------------------------------------------------------------------
// GET /admin/users
//
// Server-side filtering + pagination — frontend never pulls more than one
// page, so the table stays fast even for thousands of users.
// ---------------------------------------------------------------------------
const SEGMENTS = [
  'all',
  'recruiters',
  'consultants',
  'managers',
  'pending',
  'locked',
  'forced_reset',
  'no_login_30d',
] as const;

const listSchema = z.object({
  q: z.string().trim().max(120).optional(),
  role: z.enum(ALL_ROLES as unknown as [Role, ...Role[]]).optional(),
  status: z.enum(STATUSES).optional(),
  segment: z.enum(SEGMENTS).optional(),
  group_id: z.string().uuid().optional(),
  last_seen: z.enum(['24h', '7d', '30d']).optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(50),
  sort: z
    .enum(['created_at', 'last_login_at', 'last_seen_at', 'email', 'full_name'])
    .default('created_at'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

export const list: RequestHandler = async (req, res) => {
  const parsed = listSchema.safeParse(req.query);
  if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message ?? 'Invalid query');
  const { q, role, status, segment, group_id, last_seen, page, page_size, sort, order } =
    parsed.data;

  const from = (page - 1) * page_size;
  const to = from + page_size - 1;

  // PostgREST returns the matched-row count in the response when we ask for
  // it via `count: 'exact'`. That's what powers the pagination footer.
  let query = db
    .from('users')
    .select(
      'id, email, full_name, role, status, must_change_password, group_id, ' +
        'created_at, updated_at, last_login_at, last_seen_at, status_reason',
      { count: 'exact' },
    )
    .order(sort, { ascending: order === 'asc', nullsFirst: false })
    .range(from, to);

  if (role) query = query.eq('role', role);
  if (status) query = query.eq('status', status);
  // Segment shortcuts from the UserSegments ribbon. Each maps to a server-side
  // WHERE so the count + pagination stay correct across the whole dataset.
  const MANAGER_ROLE_LIST = [
    'SUPER_ADMIN',
    'CEO',
    'CTO',
    'DIRECTOR',
    'MANAGER',
    'HR_MANAGER',
    'DEVELOPER',
  ];
  switch (segment) {
    case 'recruiters':
      query = query.eq('role', 'RECRUITER');
      break;
    case 'consultants':
      query = query.eq('role', 'CONSULTANT');
      break;
    case 'managers':
      query = query.in('role', MANAGER_ROLE_LIST);
      break;
    case 'pending':
      query = query.eq('status', 'pending_verification');
      break;
    case 'locked':
      query = query.in('status', ['suspended', 'banned']);
      break;
    case 'forced_reset':
      query = query.eq('must_change_password', true);
      break;
    case 'no_login_30d':
      query = query.lt('last_login_at', new Date(Date.now() - 30 * 86_400_000).toISOString());
      break;
    case 'all':
    default:
      break;
  }
  if (group_id) query = query.eq('group_id', group_id);
  if (last_seen) {
    const ms =
      last_seen === '24h' ? 86_400_000 : last_seen === '7d' ? 7 * 86_400_000 : 30 * 86_400_000;
    query = query.gte('last_seen_at', new Date(Date.now() - ms).toISOString());
  }
  if (q) {
    // `or()` with ilike on email + full_name covers the common search cases.
    // We escape `%` and `_` so a literal "%" in the search string doesn't
    // turn into a wildcard.
    const safe = q.replace(/[%_]/g, (m) => `\\${m}`);
    query = query.or(`email.ilike.%${safe}%,full_name.ilike.%${safe}%`);
  }

  const { data, error, count } = await query;
  if (error) throw httpError(500, 'Database error');

  // Enrich each row with its live (non-expired) session count for the table's
  // Sessions column. One grouped query over only the page's ids — cheap, and
  // kept out of the main query so the shim's search/filter path is untouched.
  // Wrapped: if the auth_sessions table is somehow absent we just omit counts
  // rather than 500 the whole list.
  const rows = (data ?? []) as Array<Record<string, unknown> & { id: string }>;
  if (rows.length > 0) {
    try {
      const ids = rows.map((r) => r.id);
      const counts = await pool.query<{ user_id: string; n: string }>(
        `SELECT user_id, count(*)::int AS n
           FROM public.auth_sessions
          WHERE user_id = ANY($1) AND expires_at > now()
          GROUP BY user_id`,
        [ids],
      );
      const byUser = new Map(counts.rows.map((c) => [c.user_id, Number(c.n)]));
      for (const r of rows) r.session_count = byUser.get(r.id) ?? 0;
    } catch {
      for (const r of rows) r.session_count = 0;
    }
  }

  res.json({
    rows,
    page,
    page_size,
    total: count ?? 0,
    total_pages: count ? Math.ceil(count / page_size) : 0,
  });
};

// ---------------------------------------------------------------------------
// GET /admin/users/kpi
//
// Five workspace-wide counts for the KPI strip, computed in a single grouped
// scan with FILTER aggregates — much cheaper than five round-trips. Degrades
// to zeros (rather than a 500) if a late-migration column isn't present yet.
// ---------------------------------------------------------------------------
// Role buckets shared by the KPI segment counts and the list `segment` filter.
const MANAGER_ROLES = "('SUPER_ADMIN','CEO','CTO','DIRECTOR','MANAGER','HR_MANAGER','DEVELOPER')";

export const kpi: RequestHandler = async (_req, res) => {
  const empty = {
    active: 0,
    online: 0,
    pending: 0,
    locked: 0,
    inactive: 0,
    total: 0,
    recruiters: 0,
    consultants: 0,
    managers: 0,
    forced_reset: 0,
    no_login_30d: 0,
  };
  try {
    const r = await pool.query<Record<keyof typeof empty, string>>(
      `SELECT
         count(*)                                                                         AS total,
         count(*) FILTER (WHERE coalesce(status, 'active') = 'active')                    AS active,
         count(*) FILTER (WHERE last_seen_at > now() - interval '5 minutes')              AS online,
         count(*) FILTER (WHERE status = 'pending_verification')                          AS pending,
         count(*) FILTER (WHERE status IN ('suspended', 'banned'))                        AS locked,
         count(*) FILTER (WHERE role = 'RECRUITER')                                       AS recruiters,
         count(*) FILTER (WHERE role = 'CONSULTANT')                                      AS consultants,
         count(*) FILTER (WHERE role IN ${MANAGER_ROLES})                                 AS managers,
         count(*) FILTER (WHERE must_change_password = true)                              AS forced_reset,
         count(*) FILTER (
           WHERE coalesce(last_login_at, '-infinity'::timestamptz) < now() - interval '30 days'
         )                                                                                AS no_login_30d,
         count(*) FILTER (
           WHERE coalesce(status, 'active') = 'active'
             AND coalesce(last_seen_at, last_login_at, '-infinity'::timestamptz)
                 < now() - interval '30 days'
         )                                                                                AS inactive
       FROM public.users`,
    );
    const row = r.rows[0];
    if (!row) return res.json(empty);
    const out = { ...empty };
    for (const k of Object.keys(empty) as (keyof typeof empty)[]) out[k] = Number(row[k]) || 0;
    res.json(out);
  } catch {
    res.json(empty);
  }
};

// ---------------------------------------------------------------------------
// GET /admin/users/:id/sessions
//
// Active (non-expired) refresh-token sessions for one user. The raw token is
// never stored (only a bcrypt hash) so we can't surface it; we return the
// device/ip metadata captured at issue time. There is no per-session "current
// device" marker because the access token doesn't carry its session id.
// ---------------------------------------------------------------------------
export const sessions: RequestHandler = async (req, res) => {
  const { id } = req.params;
  try {
    const r = await pool.query<{
      id: string;
      issued_at: string;
      expires_at: string;
      user_agent: string | null;
      ip_address: string | null;
    }>(
      `SELECT id, issued_at, expires_at, user_agent, ip_address
         FROM public.auth_sessions
        WHERE user_id = $1 AND expires_at > now()
        ORDER BY issued_at DESC`,
      [id],
    );
    res.json(r.rows);
  } catch {
    res.json([]);
  }
};

/** Loads a target's email+role and refuses if the actor doesn't outrank them. */
async function loadTargetOrThrow(actor: { role: Role }, id: string) {
  const { data } = await db.from('users').select('id, email, role').eq('id', id).maybeSingle();
  if (!data) throw httpError(404, 'User not found');
  const row = data as { id: string; email: string; role: Role };
  assertOutranks(actor, row.role);
  return row;
}

// ---------------------------------------------------------------------------
// DELETE /admin/users/:id/sessions/:sessionId   — revoke one session
// DELETE /admin/users/:id/sessions              — revoke all sessions
// ---------------------------------------------------------------------------
export const revokeSession: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const { id, sessionId } = req.params;
  const target = await loadTargetOrThrow({ role: req.user.role }, id);
  const r = await pool.query(`DELETE FROM public.auth_sessions WHERE id = $1 AND user_id = $2`, [
    sessionId,
    id,
  ]);
  audit({
    action: 'admin_session_revoked',
    user_id: id,
    email: target.email,
    req,
    metadata: { by: req.user.id, session_id: sessionId },
  });
  res.json({ ok: true, revoked: r.rowCount ?? 0 });
};

export const revokeAllSessions: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const { id } = req.params;
  const target = await loadTargetOrThrow({ role: req.user.role }, id);
  const { error } = await db.auth.admin.signOut(id, 'global');
  if (error) throw httpError(500, 'Database error');
  audit({
    action: 'admin_sessions_revoked_all',
    user_id: id,
    email: target.email,
    req,
    metadata: { by: req.user.id },
  });
  res.json({ ok: true });
};

// ---------------------------------------------------------------------------
// POST /admin/users/:id/force-password-change
//
// Sets must_change_password and revokes all sessions so the user is forced
// through the change-password flow on next sign-in.
// ---------------------------------------------------------------------------
export const forcePasswordChange: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const { id } = req.params;
  if (req.user.id === id)
    throw httpError(400, 'Use your own account settings to change your password.');
  const target = await loadTargetOrThrow({ role: req.user.role }, id);
  const { error } = await db.from('users').update({ must_change_password: true }).eq('id', id);
  if (error) throw httpError(500, 'Database error');
  await db.auth.admin.signOut(id, 'global').catch(() => {});
  audit({
    action: 'admin_user_force_password_change',
    user_id: id,
    email: target.email,
    req,
    metadata: { by: req.user.id },
  });
  res.json({ ok: true });
};

// ---------------------------------------------------------------------------
// POST /admin/users/:id/impersonate
//
// SUPER_ADMIN-only. Mints a real session for the target and returns it so the
// admin's browser can adopt it. Rank-gated (can't impersonate an equal/higher
// admin) and audited. The impersonated session is a normal login — it ends
// when the target next signs out globally or their status changes.
// ---------------------------------------------------------------------------
export const impersonate: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  if (req.user.role !== 'SUPER_ADMIN') throw httpError(403, 'Only a SUPER_ADMIN can impersonate.');
  const { id } = req.params;
  if (req.user.id === id) throw httpError(400, 'You are already signed in as yourself.');

  const { data: target } = await db
    .from('users')
    .select('id, email, full_name, role')
    .eq('id', id)
    .maybeSingle();
  if (!target) throw httpError(404, 'User not found');
  const t = target as { id: string; email: string; full_name: string | null; role: Role };
  // Can't impersonate an equal/higher-ranked admin (another SUPER_ADMIN).
  assertOutranks({ role: req.user.role }, t.role);

  const { data, error } = await db.auth.admin.createSessionForUser(id);
  if (error || !data?.session) {
    throw httpError(500, 'Failed to start impersonation');
  }
  audit({
    action: 'admin_user_impersonated',
    user_id: id,
    email: t.email,
    req,
    metadata: { by: req.user.id, by_email: req.user.email },
  });
  const s = data.session;
  res.json({
    access_token: s.access_token,
    refresh_token: s.refresh_token,
    expires_at: s.expires_at,
    user: { id: t.id, email: t.email, full_name: t.full_name, role: t.role },
  });
};

// ---------------------------------------------------------------------------
// GET /admin/users/:id
//
// Returns the full profile + role-specific context. We reuse the existing
// /users/:id payload shape so the frontend's UserProfile.tsx component can
// render either the admin view or a self-view.
// ---------------------------------------------------------------------------
// PATCH /admin/users/:id/capabilities
//
// SUPER_ADMIN-only. Sets the capability grants for a DEVELOPER ("scoped
// super-admin"). Validated against the fixed catalog; only applies to DEVELOPER
// accounts. The hard bar (create SUPER_ADMIN/DEVELOPER, impersonate-super-admin,
// last-super-admin) is NOT in the catalog and stays SUPER_ADMIN-only elsewhere.
const capabilitiesSchema = z
  .object({ capabilities: z.array(z.enum(DEVELOPER_CAPABILITIES)) })
  .strict();

export const setCapabilities: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  if (req.user.role !== 'SUPER_ADMIN') {
    throw httpError(403, 'Only a SUPER_ADMIN can set developer capabilities.');
  }
  const parsed = capabilitiesSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid capabilities', parsed.error.flatten());

  const { data: target } = await db
    .from('users')
    .select('id, email, role')
    .eq('id', req.params.id)
    .maybeSingle();
  if (!target) throw httpError(404, 'User not found');
  const t = target as { id: string; email: string; role: Role };
  if (t.role !== 'DEVELOPER') {
    throw httpError(400, 'Capabilities apply only to DEVELOPER accounts.');
  }

  const caps = [...new Set(parsed.data.capabilities)];
  const { error } = await db.from('users').update({ capabilities: caps }).eq('id', t.id);
  if (error) throw httpError(500, error.message);

  audit({
    action: 'developer_capabilities_set',
    user_id: t.id,
    email: t.email,
    req,
    metadata: { capabilities: caps, by: req.user.id },
  });
  res.json({ ok: true, capabilities: caps });
};

export const get: RequestHandler = async (req, res) => {
  const { id } = req.params;
  const { data, error } = await db.from('users').select('*').eq('id', id).maybeSingle();
  if (error) throw httpError(500, 'Database error');
  if (!data) throw httpError(404, 'User not found');

  // Role-specific context (consultants/recruiters joins) — same enrichment
  // the public /users/:id does.
  const context: any = {};
  if (data.role === 'CONSULTANT') {
    const consResult = await db
      .from('consultants')
      .select(
        'id, recruiter_id, primary_skill, skills, total_experience_years, ' +
          'visa_status, current_location, preferred_locations, marketing_status, ' +
          'linkedin_url, github_url',
      )
      .eq('user_id', data.id)
      .maybeSingle();
    const cons: any = consResult.data;
    if (cons) {
      context.consultant = cons;
      if (cons.recruiter_id) {
        const { data: rec } = await db
          .from('recruiters')
          .select('id, team, user:users!user_id(id, full_name, email)')
          .eq('id', cons.recruiter_id)
          .maybeSingle();
        context.recruiter = rec;
      }
    }
  } else if (data.role === 'RECRUITER') {
    const { data: rec } = await db
      .from('recruiters')
      .select(
        'id, team, target_submissions_per_week, manager_id, ' +
          'manager:users!manager_id(id, full_name, email)',
      )
      .eq('user_id', data.id)
      .maybeSingle();
    context.recruiter = rec;
  }

  res.json({ ...data, context });
};

// ---------------------------------------------------------------------------
// PATCH /admin/users/:id/status
//
// Centralized status changer. Any non-`active` value also revokes the user's
// refresh tokens so they can't continue using a still-valid access token
// past its short TTL. Audit logged.
// ---------------------------------------------------------------------------
const statusSchema = z.object({
  status: z.enum(STATUSES),
  reason: z.string().trim().max(500).optional(),
});

export const setStatus: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const { id } = req.params;
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message ?? 'Invalid input');
  const { status, reason } = parsed.data;

  // Self-protection: an admin can't lock themselves out by accident.
  if (req.user.id === id && status !== 'active') {
    throw httpError(400, 'Refusing to change your own status — ask another admin.');
  }

  const { data: before } = await db
    .from('users')
    .select('id, email, status, role')
    .eq('id', id)
    .maybeSingle();
  if (!before) throw httpError(404, 'User not found');
  const beforeRow = before as { id: string; email: string; status: string | null; role: Role };

  // Rank check: only a SUPER_ADMIN can flip the status of another tier-A
  // admin. Without this a DIRECTOR/CTO could lock out the only SUPER_ADMIN.
  assertOutranks({ role: req.user.role }, beforeRow.role);

  // Don't allow the org to drop its last active SUPER_ADMIN. Mirrors the
  // legacy /users/:id/deactivate handler.
  if (status !== 'active') {
    await assertNotLastSuperAdmin(id);
  }

  const now = new Date().toISOString();
  const { data, error } = await db
    .from('users')
    .update({
      status,
      status_reason: reason ?? null,
      status_changed_at: now,
      status_changed_by: req.user.id,
      // Keep the legacy boolean in sync for any older code paths that still
      // read is_active. New code should read `status` directly.
      is_active: status === 'active',
    })
    .eq('id', id)
    .select('id, email, status, status_reason, status_changed_at')
    .single();
  if (error) throw httpError(500, 'Database error');

  // Revoke ALL of the user's refresh tokens whenever they leave the active
  // state. Without this, a still-valid access token (TTL up to 1h) could
  // continue making requests until expiry.
  if (status !== 'active') {
    await db.auth.admin.signOut(id, 'global').catch((e) => {
      logger.warn({ err: e }, 'admin status change: signOut failed');
    });
  }

  // Audit. Different action verbs based on direction so the audit log
  // reads naturally.
  audit({
    action: status === 'active' ? 'admin_user_reactivated' : 'admin_user_deactivated',
    user_id: id,
    email: data.email,
    req,
    metadata: { from: beforeRow.status, to: status, reason: reason ?? null, by: req.user.id },
  });

  res.json(data);
};

// ---------------------------------------------------------------------------
// PATCH /admin/users/:id/group
//
// Admin can move a user into a group, or out of any group (group_id: null
// for the "No Group" path). Emits a different audit verb depending on
// whether this is an initial assignment, removal, or move.
// ---------------------------------------------------------------------------
const groupSchema = z.object({ group_id: z.string().uuid().nullable() });
export const setGroup: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const { id } = req.params;
  const parsed = groupSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message ?? 'Invalid input');

  const { data: before } = await db
    .from('users')
    .select('id, email, group_id, role')
    .eq('id', id)
    .maybeSingle();
  if (!before) throw httpError(404, 'User not found');
  const beforeRow = before as { id: string; email: string; group_id: string | null; role: Role };

  // Same rank rule as setStatus — a DIRECTOR shouldn't be able to move a
  // SUPER_ADMIN out of their group.
  assertOutranks({ role: req.user.role }, beforeRow.role);

  const { data, error } = await db
    .from('users')
    .update({ group_id: parsed.data.group_id })
    .eq('id', id)
    .select('id, email, group_id')
    .single();
  if (error) throw httpError(500, 'Database error');

  const from = beforeRow.group_id ?? null;
  const to = parsed.data.group_id;
  const action: 'group_user_assigned' | 'group_user_removed' | 'group_user_moved' =
    from === null && to !== null
      ? 'group_user_assigned'
      : from !== null && to === null
        ? 'group_user_removed'
        : 'group_user_moved';
  audit({
    action,
    user_id: id,
    email: data.email,
    req,
    metadata: { from, to, by: req.user.id },
  });

  res.json(data);
};

// ---------------------------------------------------------------------------
// PATCH /admin/users/:id/notes
//
// Admin-only free-text scratchpad. Never exposed to the user themselves.
// ---------------------------------------------------------------------------
const notesSchema = z.object({ admin_notes: z.string().max(5000).nullable() });
export const setNotes: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const { id } = req.params;
  // Prevent lower-rank admins from annotating equal- or higher-tier users.
  await loadTargetOrThrow({ role: req.user.role }, id);
  const parsed = notesSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid input');
  const { data, error } = await db
    .from('users')
    .update({ admin_notes: parsed.data.admin_notes })
    .eq('id', id)
    .select('id, admin_notes')
    .single();
  if (error) throw httpError(500, 'Database error');
  res.json(data);
};

// ---------------------------------------------------------------------------
// POST /admin/users/:id/send-password-reset
//
// Admin-triggered password reset. Generates a fresh token (15-min TTL) and
// emails it via Brevo — same flow as the user-initiated forgot-password.
// Returns 204 with no body so we don't leak whether the user existed
// (consistent with the public endpoint's anti-enumeration behavior).
// ---------------------------------------------------------------------------
export const sendPasswordReset: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const { id } = req.params;
  const { data: target } = await db.from('users').select('email, role').eq('id', id).maybeSingle();
  if (!target) throw httpError(404, 'User not found');
  const targetRow = target as { email: string; role: Role };

  // Only a SUPER_ADMIN can trigger a password reset for another admin-tier
  // account. Without this rule, a DIRECTOR could send themselves the reset
  // link for the SUPER_ADMIN's email (they don't see the link directly, but
  // it's still a privilege-escalation primitive if they control the mailbox
  // — and absent that, it's a nuisance + audit-trail noise we can avoid).
  assertOutranks({ role: req.user.role }, targetRow.role);

  await requestPasswordReset(targetRow.email, req);
  audit({
    action: 'admin_user_password_reset',
    user_id: id,
    email: target.email,
    req,
    metadata: { by: req.user.id },
  });
  res.json({ ok: true });
};

// ---------------------------------------------------------------------------
// GET /admin/users/:id/audit
//
// Last 200 audit events for this user. Used by the admin detail page's
// activity timeline.
// ---------------------------------------------------------------------------
export const auditLog: RequestHandler = async (req, res) => {
  const { id } = req.params;
  const { data, error } = await db
    .from('auth_audit_logs')
    .select('id, action, ip_address, user_agent, metadata, created_at, email')
    .eq('user_id', id)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw httpError(500, 'Database error');
  res.json(data ?? []);
};

// ---------------------------------------------------------------------------
// GET /admin/audit
//
// Platform-wide audit log. Supports filtering by action, user_id, email,
// and date range. Returns up to 200 rows per page (offset pagination).
// ---------------------------------------------------------------------------
export const globalAuditLog: RequestHandler = async (req, res) => {
  const {
    action,
    user_id,
    email,
    from,
    to,
    limit: limitQ,
    offset: offsetQ,
  } = req.query as Record<string, string | undefined>;

  const limitN = Math.min(Number(limitQ ?? 50), 200);
  const offsetN = Number(offsetQ ?? 0);

  let q = db
    .from('auth_audit_logs')
    .select('id, action, user_id, email, ip_address, user_agent, metadata, created_at')
    .order('created_at', { ascending: false })
    .limit(limitN);

  if (offsetN > 0) q = q.range(offsetN, offsetN + limitN - 1);
  if (action) q = q.eq('action', action);
  if (user_id) q = q.eq('user_id', user_id);
  if (email) q = q.eq('email', email.toLowerCase());
  if (from) q = q.gte('created_at', from);
  if (to) q = q.lte('created_at', to);

  const { data, error } = await q;
  if (error) throw httpError(500, 'Database error');
  res.json(data ?? []);
};

// ---------------------------------------------------------------------------
// POST /admin/users/bulk
//
// Apply one lifecycle action to many users. Each id is guarded independently
// (rank check + last-super-admin + self-protection); failures are collected
// per-id rather than aborting the batch. All status changes funnel through the
// same fields setStatus uses so audit + session revocation stay consistent.
// ---------------------------------------------------------------------------
const bulkSchema = z
  .object({
    ids: z.array(z.string().uuid()).min(1).max(200),
    action: z.enum(['reset-password', 'change-role', 'move-group', 'suspend', 'deactivate']),
    payload: z
      .object({
        role: z.enum(ALL_ROLES as unknown as [Role, ...Role[]]).optional(),
        group_id: z.string().uuid().nullable().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const bulk: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const parsed = bulkSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message ?? 'Invalid input');
  const { ids, action, payload } = parsed.data;
  const actor = { id: req.user.id, role: req.user.role };

  const results: { id: string; ok: boolean; error?: string }[] = [];
  for (const id of ids) {
    try {
      if (id === actor.id && action !== 'reset-password') {
        throw httpError(400, 'Refusing to apply this action to your own account.');
      }
      const { data } = await db
        .from('users')
        .select('id, email, role, status')
        .eq('id', id)
        .maybeSingle();
      if (!data) throw httpError(404, 'User not found');
      const row = data as { id: string; email: string; role: Role; status: string | null };
      assertOutranks(actor, row.role);

      if (action === 'reset-password') {
        await requestPasswordReset(row.email, req);
        audit({
          action: 'admin_user_password_reset',
          user_id: id,
          email: row.email,
          req,
          metadata: { by: actor.id, bulk: true },
        });
      } else if (action === 'change-role') {
        const newRole = payload?.role;
        if (!newRole) throw httpError(400, 'A role is required.');
        assertOutranks(actor, newRole); // can't promote to a tier you don't outrank
        const { error } = await db.from('users').update({ role: newRole }).eq('id', id);
        if (error) throw httpError(500, 'Database error');
        audit({
          action: 'admin_role_changed',
          user_id: id,
          email: row.email,
          req,
          metadata: { from: row.role, to: newRole, by: actor.id, bulk: true },
        });
      } else if (action === 'move-group') {
        const { error } = await db
          .from('users')
          .update({ group_id: payload?.group_id ?? null })
          .eq('id', id);
        if (error) throw httpError(500, 'Database error');
        audit({
          action: payload?.group_id ? 'group_user_moved' : 'group_user_removed',
          user_id: id,
          email: row.email,
          req,
          metadata: { to: payload?.group_id ?? null, by: actor.id, bulk: true },
        });
      } else {
        // suspend | deactivate
        const next = action === 'suspend' ? 'suspended' : 'inactive';
        await assertNotLastSuperAdmin(id);
        const { error } = await db
          .from('users')
          .update({
            status: next,
            status_changed_at: new Date().toISOString(),
            status_changed_by: actor.id,
            is_active: false,
          })
          .eq('id', id);
        if (error) throw httpError(500, 'Database error');
        await db.auth.admin.signOut(id, 'global').catch(() => {});
        audit({
          action: 'admin_user_deactivated',
          user_id: id,
          email: row.email,
          req,
          metadata: { to: next, by: actor.id, bulk: true },
        });
      }
      results.push({ id, ok: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'failed';
      results.push({ id, ok: false, error: msg });
    }
  }

  audit({
    action: 'admin_users_bulk_action',
    user_id: actor.id,
    email: req.user.email,
    req,
    metadata: { action, requested: ids.length, ok: results.filter((r) => r.ok).length },
  });
  res.json({ results });
};

/**
 * PATCH /admin/users/:id/role
 *
 * Change a single user's role.
 *
 * Access tiers:
 *  - ADMIN_TIER  → can change any user whose role they outrank
 *  - MANAGER_TIER (non-admin) → same rank check PLUS both users must be in
 *    the same group (group-scoped delegation)
 */
export const setRole: RequestHandler = async (req, res) => {
  const actor = req.user!;
  const targetId = req.params.id;

  const { role: newRole } = z
    .object({ role: z.enum(ALL_ROLES as [Role, ...Role[]]) })
    .parse(req.body);

  if (actor.id === targetId) throw httpError(400, 'You cannot change your own role');

  // Load target
  const { data: target } = await db
    .from('users')
    .select('id, email, role, group_id')
    .eq('id', targetId)
    .maybeSingle();
  if (!target) throw httpError(404, 'Not found');

  const row = target as { id: string; email: string; role: Role; group_id: string | null };

  assertOutranks(actor, row.role); // can't touch equal/higher users
  assertOutranks(actor, newRole); // can't promote to your own tier or above

  // Only MANAGER role is group-scoped; HR_MANAGER and DEVELOPER may have no group
  if (actor.role === 'MANAGER') {
    // Load actor's group_id from DB (not always in the JWT)
    const { data: actorRow } = await db
      .from('users')
      .select('group_id')
      .eq('id', actor.id)
      .maybeSingle();
    const actorGroupId = (actorRow as { group_id: string | null } | null)?.group_id ?? null;

    if (!actorGroupId || actorGroupId !== row.group_id) {
      throw httpError(403, 'You can only change roles of users in your group');
    }
  }

  const prev = row.role;
  const { error } = await db.from('users').update({ role: newRole }).eq('id', targetId);
  if (error) throw httpError(500, 'Database error');

  audit({
    action: 'admin_role_changed',
    user_id: targetId,
    email: row.email,
    req,
    metadata: { from: prev, to: newRole, by: actor.id },
  });

  res.json({ ok: true, role: newRole });
};
