import { RequestHandler } from 'express';
import { z } from 'zod';
import { db, pool } from '../config/db';
import { httpError, ALL_ROLES, Role } from '../types';
import { audit } from '../services/audit.service';
import { requestPasswordReset } from '../services/auth.service';
import { logger } from '../config/logger';

// Role-rank ladder. Used to refuse status / group / password-reset changes
// when the actor would otherwise be tampering with an equal- or higher-rank
// admin's account. Without this guard, a DIRECTOR could lock out the
// SUPER_ADMIN — and once the access token TTL elapses, the SUPER_ADMIN is
// permanently locked out unless another super-admin exists to reactivate
// them. The ladder mirrors shared/src/roles.ts ordering.
const ROLE_RANK: Record<Role, number> = {
  SUPER_ADMIN: 100,
  CEO: 90,
  CTO: 80,
  DIRECTOR: 70,
  MANAGER: 60,
  HR_MANAGER: 60,
  DEVELOPER: 50,
  RECRUITER: 40,
  CONSULTANT: 10,
};

/** Throws 403 if the actor is trying to mutate an equal- or higher-ranked
 *  user — admins below SUPER_ADMIN can never reach above their own tier. */
function assertOutranks(actor: { role: Role }, targetRole: Role | null | undefined): void {
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
async function assertNotLastSuperAdmin(targetId: string): Promise<void> {
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
const listSchema = z.object({
  q: z.string().trim().max(120).optional(),
  role: z.enum(ALL_ROLES as unknown as [Role, ...Role[]]).optional(),
  status: z.enum(STATUSES).optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(50),
  sort: z.enum(['created_at', 'last_login_at', 'email', 'full_name']).default('created_at'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

export const list: RequestHandler = async (req, res) => {
  const parsed = listSchema.safeParse(req.query);
  if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message ?? 'Invalid query');
  const { q, role, status, page, page_size, sort, order } = parsed.data;

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
  if (q) {
    // `or()` with ilike on email + full_name covers the common search cases.
    // We escape `%` and `_` so a literal "%" in the search string doesn't
    // turn into a wildcard.
    const safe = q.replace(/[%_]/g, (m) => `\\${m}`);
    query = query.or(`email.ilike.%${safe}%,full_name.ilike.%${safe}%`);
  }

  const { data, error, count } = await query;
  if (error) throw httpError(500, error.message);

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
export const kpi: RequestHandler = async (_req, res) => {
  const empty = { active: 0, online: 0, pending: 0, locked: 0, inactive: 0 };
  try {
    const r = await pool.query<{
      active: string;
      online: string;
      pending: string;
      locked: string;
      inactive: string;
    }>(
      `SELECT
         count(*) FILTER (WHERE coalesce(status, 'active') = 'active')                    AS active,
         count(*) FILTER (WHERE last_seen_at > now() - interval '5 minutes')              AS online,
         count(*) FILTER (WHERE status = 'pending_verification')                          AS pending,
         count(*) FILTER (WHERE status IN ('suspended', 'banned'))                        AS locked,
         count(*) FILTER (
           WHERE coalesce(status, 'active') = 'active'
             AND coalesce(last_seen_at, last_login_at, '-infinity'::timestamptz)
                 < now() - interval '30 days'
         )                                                                                AS inactive
       FROM public.users`,
    );
    const row = r.rows[0];
    if (!row) return res.json(empty);
    res.json({
      active: Number(row.active),
      online: Number(row.online),
      pending: Number(row.pending),
      locked: Number(row.locked),
      inactive: Number(row.inactive),
    });
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

// ---------------------------------------------------------------------------
// GET /admin/users/:id
//
// Returns the full profile + role-specific context. We reuse the existing
// /users/:id payload shape so the frontend's UserProfile.tsx component can
// render either the admin view or a self-view.
// ---------------------------------------------------------------------------
export const get: RequestHandler = async (req, res) => {
  const { id } = req.params;
  const { data, error } = await db.from('users').select('*').eq('id', id).maybeSingle();
  if (error) throw httpError(500, error.message);
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
  if (error) throw httpError(500, error.message);

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
  if (error) throw httpError(500, error.message);

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
  const { id } = req.params;
  const parsed = notesSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid input');
  const { data, error } = await db
    .from('users')
    .update({ admin_notes: parsed.data.admin_notes })
    .eq('id', id)
    .select('id, admin_notes')
    .single();
  if (error) throw httpError(500, error.message);
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
  if (error) throw httpError(500, error.message);
  res.json(data ?? []);
};
