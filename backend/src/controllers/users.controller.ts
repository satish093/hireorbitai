import { RequestHandler } from 'express';
import { z } from 'zod';
import { db } from '../config/db';
import { httpError, MANAGER_TIER, OPERATOR_TIER, Role, ALL_ROLES } from '../types';
import * as authSvc from '../services/auth.service';

/** Columns returned on every profile fetch. We keep this list explicit so a
 *  schema migration that lags doesn't break the read path. */
const PROFILE_COLS_FULL =
  'id, email, full_name, first_name, last_name, phone, role, avatar_url, is_active, ' +
  'last_seen_at, group_id, reports_to, ' +
  'address_line1, address_line2, city, state, postal_code, country, timezone, linkedin_url, ' +
  'created_at, updated_at';
const PROFILE_COLS_LEGACY =
  'id, email, full_name, phone, role, avatar_url, is_active, created_at, updated_at';

function isManagerTier(role: Role | undefined): boolean {
  return !!role && (MANAGER_TIER as Role[]).includes(role);
}
function isOperatorTier(role: Role | undefined): boolean {
  return !!role && (OPERATOR_TIER as Role[]).includes(role);
}

/** Can the calling user view the target user's profile?
 *   - MANAGER_TIER / RECRUITER (= OPERATOR_TIER): yes, for anyone in the org.
 *   - CONSULTANT: only their own profile. */
async function canViewProfile(
  caller: { id: string; role: Role },
  targetUserId: string,
): Promise<boolean> {
  if (caller.id === targetUserId) return true;
  if (isOperatorTier(caller.role)) return true;
  return false;
}

/** Can the calling user edit the target user's profile?
 *   - MANAGER_TIER: yes (full org admin).
 *   - Anyone else: only their own profile. */
function canEditProfile(caller: { id: string; role: Role }, targetUserId: string): boolean {
  if (caller.id === targetUserId) return true;
  return isManagerTier(caller.role);
}

/** GET /users/:id — fetch one user's profile (scoped). */
export const get: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  if (!(await canViewProfile(req.user, req.params.id))) throw httpError(403, 'Forbidden');

  let data: any = null;
  let error: any = null;
  ({ data, error } = await db
    .from('users')
    .select(PROFILE_COLS_FULL)
    .eq('id', req.params.id)
    .maybeSingle());
  if (error && /column .* does not exist|schema cache/i.test(error.message)) {
    ({ data, error } = await db
      .from('users')
      .select(PROFILE_COLS_LEGACY)
      .eq('id', req.params.id)
      .maybeSingle());
  }
  if (error) throw httpError(500, error.message);
  if (!data) throw httpError(404, 'User not found');

  // Enrich with role-specific context (consultant + recruiter linkage), so
  // the profile page can show "Reports to: …" / "Recruiter: …".
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
          .select('id, team, user:users!user_id(id, full_name, email, phone)')
          .eq('id', cons.recruiter_id)
          .maybeSingle();
        context.recruiter = rec;
      }
    }
  } else if (data.role === 'RECRUITER') {
    const { data: rec } = await db
      .from('recruiters')
      .select(
        'id, manager_id, team, target_submissions_per_week, ' +
          'manager:users!manager_id(id, full_name, email)',
      )
      .eq('user_id', data.id)
      .maybeSingle();
    context.recruiter = rec;
  }

  res.json({ ...data, context });
};

/** PATCH /users/:id — update profile fields (self or admin). */
export const update: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  if (!canEditProfile(req.user, req.params.id)) throw httpError(403, 'Forbidden');

  // URL fields restrict to http(s) so a stored `javascript:` or `data:`
  // URL can't render later in another user's browser. Same refinement we
  // use in syncProfile (auth.controller.ts). `.max()` MUST come before
  // `.refine()` — refine returns ZodEffects which doesn't expose .max.
  const httpUrl = z
    .string()
    .max(2048)
    .url()
    .refine((v) => /^https?:\/\//i.test(v), 'must be an http(s) URL');

  const schema = z
    .object({
      full_name: z.string().max(120).optional(),
      first_name: z.string().max(60).optional(),
      last_name: z.string().max(60).optional(),
      phone: z.string().max(40).optional().nullable(),
      avatar_url: httpUrl.optional().or(z.literal('')).nullable(),
      address_line1: z.string().max(120).optional().nullable(),
      address_line2: z.string().max(120).optional().nullable(),
      city: z.string().max(80).optional().nullable(),
      state: z.string().max(80).optional().nullable(),
      postal_code: z.string().max(20).optional().nullable(),
      country: z.string().max(60).optional().nullable(),
      timezone: z.string().max(60).optional().nullable(),
      linkedin_url: httpUrl.optional().or(z.literal('')).nullable(),
    })
    .strict(); // reject unknown fields outright instead of silently stripping
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());

  // Deterministic full_name handling. Three input shapes:
  //   A. Caller sends first_name and/or last_name → ALWAYS recompute
  //      full_name from those, ignoring any value the client sent in the
  //      same payload. Previously we only recomputed when full_name was
  //      absent, so a stale full_name on the form (which the old client
  //      always sent) silently won and edits to first/last never updated
  //      the displayed name.
  //   B. Caller sends only full_name → use it as-is.
  //   C. Caller sends neither → no full_name change.
  // We need access to the existing first/last to compute "did either field
  // change" correctly when only one of them is in the patch.
  const patch: Record<string, unknown> = { ...parsed.data, updated_at: new Date().toISOString() };
  const sentFirst = parsed.data.first_name !== undefined;
  const sentLast = parsed.data.last_name !== undefined;
  if (sentFirst || sentLast) {
    let firstFinal = parsed.data.first_name;
    let lastFinal = parsed.data.last_name;
    if (!sentFirst || !sentLast) {
      // Need to fetch the unchanged half so we don't blank it out.
      const { data: existing } = await db
        .from('users')
        .select('first_name, last_name')
        .eq('id', req.params.id)
        .maybeSingle();
      if (!sentFirst) firstFinal = (existing as any)?.first_name ?? null;
      if (!sentLast) lastFinal = (existing as any)?.last_name ?? null;
    }
    const composed = [firstFinal, lastFinal].filter(Boolean).join(' ').trim();
    patch.full_name = composed || null;
  }

  // Strip columns that aren't present yet (migration lag) and retry.
  const OPTIONAL = [
    'first_name',
    'last_name',
    'address_line1',
    'address_line2',
    'city',
    'state',
    'postal_code',
    'country',
    'timezone',
    'linkedin_url',
  ];
  let { data, error } = await db
    .from('users')
    .update(patch)
    .eq('id', req.params.id)
    .select(PROFILE_COLS_FULL)
    .single();
  let attempts = 0;
  while (error && attempts < OPTIONAL.length) {
    const msg = error.message ?? '';
    const isSchemaErr = /schema cache|column .* does not exist/i.test(msg);
    if (!isSchemaErr) break;
    let removed = false;
    for (const col of OPTIONAL) {
      if (msg.includes(col) && col in patch) {
        delete patch[col];
        removed = true;
        attempts++;
        break;
      }
    }
    if (!removed) break;
    ({ data, error } = await db
      .from('users')
      .update(patch)
      .eq('id', req.params.id)
      .select(PROFILE_COLS_LEGACY)
      .single());
  }
  if (error) throw httpError(500, error.message);
  res.json(data);
};

// ---------------------------------------------------------------------------
// POST /users — admin-only user creation
//
// Generates a temp password, creates the auth user, inserts the
// matching public.users row with must_change_password=true, then emails the
// temp credentials via Brevo. The route is gated by requireAdmin upstream.
// ---------------------------------------------------------------------------
const ROLE_VALUES = ALL_ROLES as readonly Role[];
const adminCreateSchema = z.object({
  email: z.string().email().max(254),
  full_name: z.string().min(1).max(120).optional(),
  role: z.enum(ROLE_VALUES as unknown as [Role, ...Role[]]),
});

export const adminCreate: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const parsed = adminCreateSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message ?? 'Invalid input');

  // Only an existing SUPER_ADMIN can mint another SUPER_ADMIN. Otherwise a
  // DIRECTOR / CTO with admin-tier access could quietly self-escalate by
  // creating a SUPER_ADMIN account and signing in as it.
  if (parsed.data.role === 'SUPER_ADMIN' && req.user.role !== 'SUPER_ADMIN') {
    throw httpError(403, 'Only a SUPER_ADMIN can create another SUPER_ADMIN.');
  }

  const { user_id } = await authSvc.adminCreateUser({
    email: parsed.data.email,
    fullName: parsed.data.full_name,
    role: parsed.data.role,
    createdBy: { id: req.user.id, email: req.user.email },
    req,
  });

  res.status(201).json({ ok: true, user_id });
};

// ---------------------------------------------------------------------------
// Admin lifecycle — deactivate, reactivate, hard-delete, and the listing
// surface for deactivated accounts. All gated by requireAdmin at the route
// level. Safety guards live in here so they can audit-log the rejection.
// ---------------------------------------------------------------------------

/** Throws if the target is the calling admin themselves. Self-destructive
 *  actions are always a footgun — admins must use a peer admin to do this. */
function assertNotSelf(req: { user?: { id: string } }, targetId: string): void {
  if (req.user?.id === targetId) {
    throw httpError(400, 'You cannot perform this action on your own account.');
  }
}

/** Throws if removing this user would leave zero active SUPER_ADMINs. The
 *  last SUPER_ADMIN is a soft singleton — losing them locks every admin
 *  surface for the whole org. */
async function assertNotLastSuperAdmin(targetId: string): Promise<void> {
  const { data: target, error: tErr } = await db
    .from('users')
    .select('role, is_active')
    .eq('id', targetId)
    .maybeSingle();
  if (tErr) throw httpError(500, tErr.message);
  if (!target) throw httpError(404, 'User not found');
  if (target.role !== 'SUPER_ADMIN' || target.is_active === false) return;

  const { count, error } = await db
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('role', 'SUPER_ADMIN')
    .eq('is_active', true);
  if (error) throw httpError(500, error.message);
  if ((count ?? 0) <= 1) {
    throw httpError(
      409,
      'Refusing to remove the last active SUPER_ADMIN. Promote another admin first.',
    );
  }
}

/** POST /users/:id/deactivate — set status=inactive AND is_active=false,
 *  revoke sessions, audit. Funnels through the shared setUserStatus() so
 *  the admin surface and this legacy route stay in lockstep — previously
 *  this only flipped is_active, leaving status=active and bypassing the
 *  middleware gate.
 *
 *  Optional body: `{ reason?: string }` — surfaces in the audit log + the
 *  status_reason column shown on the user's admin detail page. */
export const deactivate: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const targetId = req.params.id;
  assertNotSelf(req, targetId);
  await assertNotLastSuperAdmin(targetId);

  const reason =
    typeof req.body?.reason === 'string'
      ? req.body.reason.trim().slice(0, 500) || undefined
      : undefined;

  const updated = await authSvc.setUserStatus({
    targetId,
    status: 'inactive',
    reason,
    actor: { id: req.user.id, email: req.user.email },
    req,
  });
  res.json({ ok: true, user: updated });
};

/** POST /users/:id/reactivate — set status=active AND is_active=true, clear
 *  status_reason, audit. Was previously only setting is_active=true, which
 *  meant a user deactivated via /admin/users/:id/status (which set status=
 *  inactive) couldn't be revived via this route — they remained locked out
 *  by the auth middleware's status check. Now both fields flip together. */
export const reactivate: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const targetId = req.params.id;
  assertNotSelf(req, targetId);

  const updated = await authSvc.setUserStatus({
    targetId,
    status: 'active',
    reason: null,
    actor: { id: req.user.id, email: req.user.email },
    req,
  });
  res.json({ ok: true, user: updated });
};

/** DELETE /users/:id — hard delete. Removes the auth user + the public.users
 *  row. Sessions are implicitly revoked by deleting the auth user. */
export const remove: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const targetId = req.params.id;
  assertNotSelf(req, targetId);
  await assertNotLastSuperAdmin(targetId);

  // Order matters: drop public.users first so any FK cascades fire while the
  // auth user still exists for audit, then delete the auth user.
  const { error: profileErr } = await db.from('users').delete().eq('id', targetId);
  if (profileErr) throw httpError(500, profileErr.message);

  const { error: authErr } = await db.auth.admin.deleteUser(targetId);
  if (authErr) {
    // public.users is already gone — log loudly, but report success since the
    // user can no longer log in (no profile row → 403 in login()).
    // The orphan auth row should be cleaned up manually.
    // eslint-disable-next-line no-console
    console.warn(`auth user delete failed for ${targetId}:`, authErr.message);
  }

  res.json({ ok: true });
};

/** GET /users/deactivated?role=… — list every account that can't currently
 *  sign in (status != active). Captures inactive, suspended, pending, AND
 *  banned in one place so the admin only has one "who's locked out" view to
 *  check. Optional role filter. Admin only.
 *
 *  Falls back to the legacy is_active filter if the status column hasn't
 *  been migrated yet (defensive — the migration may lag a backend deploy). */
export const listDeactivated: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');

  const role =
    typeof req.query.role === 'string' && req.query.role !== 'ALL' ? req.query.role : null;
  if (role && !ROLE_VALUES.includes(role as Role)) {
    throw httpError(400, 'Invalid role filter');
  }

  // Primary filter: status != 'active'. Secondary include: rows where status
  // is null (pre-migration) but is_active is false, so older deactivations
  // remain visible until the backfill completes.
  let q = db
    .from('users')
    .select(
      'id, email, full_name, role, status, status_reason, status_changed_at, is_active, updated_at, created_at, last_seen_at',
    )
    .or('status.neq.active,and(status.is.null,is_active.eq.false)')
    .order('updated_at', { ascending: false });
  if (role) q = q.eq('role', role);

  // Use `any` for the result tuple so we can swap in the legacy-shape
  // fallback without TS narrowing the union to the lowest common subset.
  let data: any = null;
  let error: any = null;
  ({ data, error } = await q);

  // Schema-cache fallback: if `status` doesn't exist yet, fall back to the
  // legacy is_active filter so this endpoint keeps working pre-migration.
  if (error && /status|column .* does not exist|schema cache/i.test(error.message)) {
    let legacy = db
      .from('users')
      .select('id, email, full_name, role, is_active, updated_at, created_at, last_seen_at')
      .eq('is_active', false)
      .order('updated_at', { ascending: false });
    if (role) legacy = legacy.eq('role', role);
    ({ data, error } = await legacy);
  }
  if (error) throw httpError(500, error.message);
  res.json(data ?? []);
};
