import { RequestHandler } from 'express';
import { z } from 'zod';
import { db } from '../config/db';
import { env } from '../config/env';
import { createInvitation, acceptInvitation } from '../services/invitation.service';
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

  const invitation = await createInvitation({
    email: parsed.data.email,
    role: parsed.data.role,
    invitedBy: req.user.id,
  });
  res.status(201).json(invitation);
};

export const list: RequestHandler = async (_req, res) => {
  const { data, error } = await db
    .from('invitations')
    .select('*')
    .order('created_at', { ascending: false });
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
 * PUBLIC: preview an invitation by its token. Returns the email + role + status so
 * the accept page can pre-fill the form. Does NOT require auth.
 */
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
  res.json({ ...data, expired });
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
  const now = new Date().toISOString();
  const { error: upsertErr } = await db.from('users').upsert(
    {
      id: created.user.id,
      email: invite.email,
      full_name: full_name ?? null,
      role: invite.role,
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

  // 5. Mark the invitation as accepted.
  await db.from('invitations').update({ status: 'ACCEPTED', accepted_at: now }).eq('id', invite.id);

  // 6. Issue a session right now — avoids a round-trip second login on the
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
  const { id } = req.params;
  const { error } = await db.from('invitations').update({ status: 'REVOKED' }).eq('id', id);
  if (error) throw httpError(500, error.message);
  res.json({ ok: true });
};
