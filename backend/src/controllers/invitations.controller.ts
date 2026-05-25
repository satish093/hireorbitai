import { RequestHandler } from 'express';
import { z } from 'zod';
import { db } from '../config/db';
import { env } from '../config/env';
import { createInvitation, acceptInvitation } from '../services/invitation.service';
import {
  resolveAutoParent,
  isAllowedParent,
  getExpectedParentRoles,
  getAllValidParentRoles,
  wireHierarchy,
} from '../services/invitationHierarchy.service';
import { canViewUser } from '../services/permission.service';
import { validatePasswordStrength } from '../utils/password';
import { httpError, ADMIN_TIER, Role } from '../types';

const createSchema = z.object({
  email: z.string().email(),
  role: z.enum([
    'SUPER_ADMIN',
    'CEO',
    'CTO',
    'DIRECTOR',
    'MANAGER',
    'HR_MANAGER',
    'DEVELOPER',
    'RECRUITER',
    'CONSULTANT',
  ]),
  // Optional group pre-assignment. null / undefined / omitted == "No Group" —
  // the invited user lands with users.group_id = NULL.
  group_id: z.string().uuid().nullable().optional(),
  // Parent assignment. Omit for server-side auto-resolution.
  parent_user_id: z.string().uuid().nullable().optional(),
  // Admin-tier only: bypass strict hierarchy validation for the parent.
  // Ignored (and rejected) for non-admin callers.
  manual_override: z.boolean().optional(),
});

export const create: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());

  // Privilege ceiling: only admin-tier can invite an admin-tier role, and only
  // a SUPER_ADMIN can invite a SUPER_ADMIN. Without this a MANAGER could mint
  // a fresh DIRECTOR account and self-escalate via that login.
  const requestedRole = parsed.data.role as Role;
  if (requestedRole === 'SUPER_ADMIN' && req.user.role !== 'SUPER_ADMIN') {
    throw httpError(403, 'Only a SUPER_ADMIN can invite another SUPER_ADMIN.');
  }
  if (
    (ADMIN_TIER as Role[]).includes(requestedRole) &&
    !(ADMIN_TIER as Role[]).includes(req.user.role)
  ) {
    throw httpError(403, 'Admin-tier roles can only be invited by an admin.');
  }

  // ── Parent assignment ───────────────────────────────────────────────────
  let parentUserId: string | null = null;
  let assignedMode: 'auto' | 'manual' = 'auto';
  let assignedBy: string | null = null;

  const isAdminCaller = (ADMIN_TIER as Role[]).includes(req.user.role);

  if (parsed.data.parent_user_id) {
    const pId = parsed.data.parent_user_id;

    // Non-admins must be able to see the target user via the permission service.
    if (!isAdminCaller) {
      const canSee = await canViewUser({ id: req.user.id, role: req.user.role }, pId);
      if (!canSee) throw httpError(403, 'You do not have permission to assign this parent.');
    }

    // Load the target parent user.
    const { data: parentRow } = await db
      .from('users')
      .select('id, role, is_active')
      .eq('id', pId)
      .maybeSingle();
    const parent = parentRow as { id: string; role: Role; is_active: boolean | null } | null;
    if (!parent || parent.is_active === false) throw httpError(404, 'Parent user not found.');

    // Hierarchy check — SUPER_ADMIN with manual_override=true may bypass entirely.
    const bypassHierarchy = parsed.data.manual_override === true && req.user.role === 'SUPER_ADMIN';
    if (!bypassHierarchy && !isAllowedParent(requestedRole, parent.role)) {
      const expected = getExpectedParentRoles(requestedRole);
      throw httpError(
        422,
        `Invalid parent role. A ${requestedRole} requires a parent at or above the ${expected?.join(', ') ?? 'admin'} level.`,
      );
    }

    parentUserId = pId;
    assignedMode = 'manual';
    assignedBy = req.user.id;
  } else {
    // Server-side auto-resolution — frontend never guesses the parent.
    parentUserId = await resolveAutoParent(requestedRole, {
      id: req.user.id,
      role: req.user.role,
    });
  }

  const invitation = await createInvitation({
    email: parsed.data.email,
    role: parsed.data.role,
    invitedBy: req.user.id,
    groupId: parsed.data.group_id ?? null,
    parentUserId,
    assignedMode,
    assignedBy,
  });
  res.status(201).json(invitation);
};

export const list: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const isAdmin = (ADMIN_TIER as Role[]).includes(req.user.role);

  // Non-admins only see invitations they created — prevents token leakage
  // across groups and IDOR-style enumeration of other managers' invite links.
  let query = db.from('invitations').select('*').order('created_at', { ascending: false });
  if (!isAdmin) query = (query as any).eq('invited_by', req.user.id);

  const { data, error } = await query;
  if (error) throw httpError(500, error.message);
  // Surface the accept URL for PENDING invitations so managers can copy the
  // link manually if the email failed to send. Use frontendUrl — the same
  // base that the email body uses (invitation.service.ts) — so the copied
  // link and the emailed link can't diverge if APP_URL and FRONTEND_URL ever
  // point at different hosts (e.g. api.* vs app.*).
  const withUrls = (data ?? []).map((r: any) =>
    r.status === 'PENDING'
      ? { ...r, invite_url: `${env.frontendUrl}/invite/accept?token=${r.token}` }
      : r,
  );
  res.json(withUrls);
};

export const accept: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const token = String(req.body?.token ?? '');
  if (!token) throw httpError(400, 'Missing token');
  const result = await acceptInvitation(token, req.user.id);
  res.json(result);
};

/**
 * Returns the server-resolved auto-parent plus the full candidate list for the
 * given invited_role. The frontend must NOT compute the parent — it only renders
 * what this endpoint returns.
 *
 * Response shape:
 *   { auto_parent: ParentUser | null, candidates: ParentUser[] }
 *
 * auto_parent is non-null when the server can unambiguously resolve a single
 * parent (inviter IS the required role, or exactly one candidate in scope).
 * When null the frontend must show a required dropdown from candidates.
 */
export const availableParents: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const invitedRole = String(req.query.invited_role ?? '') as Role;
  const validParentRoles = getAllValidParentRoles(invitedRole);

  // Roles that need no parent (admin tier) — nothing to show.
  if (!validParentRoles) return res.json({ auto_parent: null, candidates: [] });

  type ParentUser = { id: string; full_name: string | null; email: string; role: Role };

  const isAdmin = (ADMIN_TIER as Role[]).includes(req.user.role);

  // 1. Fetch all active users whose role satisfies the parent rank requirement.
  const { data, error } = await db
    .from('users')
    .select('id, full_name, email, role, group_id')
    .in('role', validParentRoles as unknown as string[])
    .eq('is_active', true);
  if (error) throw httpError(500, error.message);

  type ParentRow = ParentUser & { group_id: string | null };
  let all = (data ?? []) as ParentRow[];

  // 2. Scope to same group for non-admins (admins see workspace-wide).
  if (!isAdmin) {
    const { data: me } = await db
      .from('users')
      .select('group_id')
      .eq('id', req.user.id)
      .maybeSingle();
    const callerGroupId = (me as { group_id?: string | null } | null)?.group_id ?? null;
    if (callerGroupId) {
      const adminRoles = ADMIN_TIER as Role[];
      all = all.filter((u) => u.group_id === callerGroupId || adminRoles.includes(u.role));
    }
  }

  const candidates: ParentUser[] = all.map((u) => ({
    id: u.id,
    full_name: u.full_name,
    email: u.email,
    role: u.role,
  }));

  // 3. Server-side auto-resolution — the only source of truth for the frontend.
  const autoId = await resolveAutoParent(invitedRole, {
    id: req.user.id,
    role: req.user.role,
  });
  // The resolved ID must be in the scoped candidates list to be surfaced.
  const auto_parent = autoId ? (candidates.find((c) => c.id === autoId) ?? null) : null;

  res.json({ auto_parent, candidates });
};

/**
 * PUBLIC: preview an invitation by its token. Returns the email + role + status so
 * the accept page can pre-fill the form. Does NOT require auth.
 */
/** Mask the local-part of an email so the preview confirms identity to the
 *  invited person without exposing the full address to a token-bruteforcer.
 *  "satish.flex07@gmail.com" → "s************@gmail.com". The invitee
 *  recognizes their own address; an attacker harvesting tokens just sees
 *  the masked form. */
function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return '***';
  const local = email.slice(0, at);
  const domain = email.slice(at);
  const head = local[0] ?? '';
  return `${head}${'*'.repeat(Math.max(2, local.length - 1))}${domain}`;
}

export const preview: RequestHandler = async (req, res) => {
  const token = String(req.query.token ?? '');
  if (!token) throw httpError(400, 'Missing token');
  const { data, error } = await db
    .from('invitations')
    .select('email, role, status, expires_at')
    .eq('token', token)
    .single();
  if (error || !data) throw httpError(404, 'Invitation not found');
  const expired = new Date(data.expires_at) < new Date();
  // Return a masked email so the invitee can confirm "yes, that's me"
  // without giving a token-bruteforcer the actual address. Same masked
  // form is fine to render in the accept-invitation UI — the user knows
  // their own email.
  res.json({
    email: maskEmail(data.email),
    role: data.role,
    status: data.status,
    expires_at: data.expires_at,
    expired,
  });
};

/**
 * PUBLIC: complete the invitation by setting a password. Creates the auth user,
 * the public.users row with the invited role, marks the invitation accepted,
 * and returns a fresh session pair so the frontend can sign the user in without
 * a second roundtrip.
 *
 * The user is choosing their own password here, so `must_change_password` is
 * explicitly set to false — they are NOT forced to immediately rotate the
 * password they just set.
 */
export const setup: RequestHandler = async (req, res) => {
  const schema = z.object({
    token: z.string().min(1),
    password: z.string().min(12, 'Password must be at least 12 characters'),
    full_name: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message ?? 'Invalid input');
  const { token, password, full_name } = parsed.data;

  // 1. Look up the invitation and validate status.
  const { data: invite, error } = await db
    .from('invitations')
    .select('*')
    .eq('token', token)
    .single();
  if (error || !invite) throw httpError(404, 'Invitation not found');
  if (invite.status !== 'PENDING') throw httpError(400, `Invitation already ${invite.status}`);
  if (new Date(invite.expires_at) < new Date()) {
    await db.from('invitations').update({ status: 'EXPIRED' }).eq('id', invite.id);
    throw httpError(400, 'Invitation expired');
  }

  // 2. Strong-password check matching the rest of the auth flows.
  const strength = validatePasswordStrength(password, { email: invite.email });
  if (!strength.ok) throw httpError(400, strength.problems.join(' '));

  // 3. Create the auth user. `email_confirm: true` is a no-op flag kept for
  //    API compatibility — all email runs through Brevo.
  const { data: created, error: createErr } = await db.auth.admin.createUser({
    email: invite.email,
    password,
    email_confirm: true,
    user_metadata: full_name ? { full_name } : undefined,
  });
  if (createErr || !created.user) {
    // Most common reason: a user already exists for this email.
    const msg = createErr?.message ?? 'Could not create user';
    throw httpError(400, msg);
  }

  // 4. Upsert the public.users row with the invited role. Explicitly clear
  //    must_change_password — the user just set their own password, no need
  //    to force a rotation on first login.
  //    If the invitation pre-assigned a group, propagate it onto the new
  //    user. Null/missing means the "No Group" path.
  const now = new Date().toISOString();
  const { error: upsertErr } = await db.from('users').upsert(
    {
      id: created.user.id,
      email: invite.email,
      full_name: full_name ?? null,
      role: invite.role,
      group_id: invite.group_id ?? null,
      must_change_password: false,
      last_password_changed_at: now,
      failed_login_attempts: 0,
      locked_until: null,
      is_active: true,
    },
    { onConflict: 'id' },
  );
  if (upsertErr) {
    // Roll back the auth user — otherwise the email is "taken" but the user
    // can never finish provisioning.
    await db.auth.admin.deleteUser(created.user.id).catch(() => {});
    throw httpError(500, upsertErr.message);
  }

  // 5. Wire org-hierarchy — non-fatal so account creation isn't blocked.
  const newUserId = created.user!.id;
  await wireHierarchy(newUserId, invite.role as Role, invite.parent_user_id ?? null).catch(
    (err: unknown) => {
      (req as any).log?.warn?.({ err, userId: newUserId }, 'hierarchy wiring failed on setup');
    },
  );

  // 6. Mark the invitation as accepted.
  await db.from('invitations').update({ status: 'ACCEPTED', accepted_at: now }).eq('id', invite.id);

  // 7. Issue a session right now — avoids a round-trip second login on the
  //    client and the brief window where the just-created user hasn't been
  //    indexed for password lookup yet.
  const fresh = await db.auth.signInWithPassword({
    email: invite.email,
    password,
  });
  if (fresh.error || !fresh.data.session) {
    // The account is provisioned; just couldn't auto-sign-in. Let the
    // frontend show the login page rather than 500ing.
    res.status(201).json({ email: invite.email, role: invite.role, session: null });
    return;
  }

  res.status(201).json({
    email: invite.email,
    role: invite.role,
    session: {
      access_token: fresh.data.session.access_token,
      refresh_token: fresh.data.session.refresh_token,
      expires_at: fresh.data.session.expires_at ?? Math.floor(Date.now() / 1000) + 3600,
    },
  });
};

export const revoke: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const { id } = req.params;
  const isAdmin = (ADMIN_TIER as Role[]).includes(req.user.role);
  const { data: inv } = await db
    .from('invitations')
    .select('id, invited_by')
    .eq('id', id)
    .maybeSingle();
  if (!inv) throw httpError(404, 'Invitation not found');
  if (!isAdmin && (inv as any).invited_by !== req.user.id) {
    throw httpError(404, 'Invitation not found');
  }
  const { error } = await db.from('invitations').update({ status: 'REVOKED' }).eq('id', id);
  if (error) throw httpError(500, error.message);
  res.json({ ok: true });
};
