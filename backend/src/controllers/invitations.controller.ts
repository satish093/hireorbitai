import { RequestHandler } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../config/supabase';
import { env } from '../config/env';
import { createInvitation, acceptInvitation } from '../services/invitation.service';
import { httpError } from '../types';

const createSchema = z.object({
  email: z.string().email(),
  role: z.enum([
    'SUPER_ADMIN', 'CEO', 'CTO', 'DIRECTOR',
    'MANAGER', 'HR_MANAGER', 'DEVELOPER',
    'RECRUITER', 'CONSULTANT',
  ]),
});

export const create: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());

  const invitation = await createInvitation({
    email: parsed.data.email,
    role: parsed.data.role,
    invitedBy: req.user.id,
  });
  res.status(201).json(invitation);
};

export const list: RequestHandler = async (_req, res) => {
  const { data, error } = await supabaseAdmin
    .from('invitations')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw httpError(500, error.message);
  // Surface the accept URL for PENDING invitations so managers can copy the
  // link manually if the email failed to send.
  const withUrls = (data ?? []).map((r: any) =>
    r.status === 'PENDING'
      ? { ...r, invite_url: `${env.appUrl}/invite/accept?token=${r.token}` }
      : r
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
  const { data, error } = await supabaseAdmin
    .from('invitations')
    .select('email, role, status, expires_at')
    .eq('token', token)
    .single();
  if (error || !data) throw httpError(404, 'Invitation not found');
  const expired = new Date(data.expires_at) < new Date();
  res.json({ ...data, expired });
};

/**
 * Complete the invitation when the user already has a Supabase auth session —
 * which happens after they click the Supabase-sent invite email. The auth user
 * already exists; we just need to update their public.users row with the
 * invited role + full_name and mark the invitation ACCEPTED.
 *
 * Requires the caller to be authenticated (the click-through gives them a
 * temporary session). Email guardrail: the session's email must match the
 * invitation's email.
 */
export const complete: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const schema = z.object({
    token: z.string().min(1),
    full_name: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());
  const { token, full_name } = parsed.data;

  const { data: invite, error } = await supabaseAdmin
    .from('invitations').select('*').eq('token', token).single();
  if (error || !invite) throw httpError(404, 'Invitation not found');
  if (invite.status !== 'PENDING') throw httpError(400, `Invitation already ${invite.status}`);
  if (new Date(invite.expires_at) < new Date()) {
    await supabaseAdmin.from('invitations').update({ status: 'EXPIRED' }).eq('id', invite.id);
    throw httpError(400, 'Invitation expired');
  }

  // Guardrail: caller's email must match the invitation's email.
  if (req.user.email.toLowerCase() !== invite.email.toLowerCase()) {
    throw httpError(
      403,
      `This invitation is for ${invite.email}, but you're signed in as ${req.user.email}.`
    );
  }

  // Upsert public.users with the invited role.
  const { error: upsertErr } = await supabaseAdmin.from('users').upsert(
    {
      id: req.user.id,
      email: invite.email,
      full_name: full_name ?? null,
      role: invite.role,
    },
    { onConflict: 'id' }
  );
  if (upsertErr) throw httpError(500, upsertErr.message);

  await supabaseAdmin
    .from('invitations')
    .update({ status: 'ACCEPTED', accepted_at: new Date().toISOString() })
    .eq('id', invite.id);

  res.json({ email: invite.email, role: invite.role });
};

/**
 * PUBLIC: complete the invitation by setting a password. Creates the auth user,
 * the public.users row with the invited role, marks the invitation accepted.
 * Returns { email } so the frontend can sign in with the provided password.
 */
export const setup: RequestHandler = async (req, res) => {
  const schema = z.object({
    token: z.string().min(1),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    full_name: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, 'Invalid input', parsed.error.flatten());
  const { token, password, full_name } = parsed.data;

  // 1. Look up the invitation and validate status.
  const { data: invite, error } = await supabaseAdmin
    .from('invitations').select('*').eq('token', token).single();
  if (error || !invite) throw httpError(404, 'Invitation not found');
  if (invite.status !== 'PENDING') throw httpError(400, `Invitation already ${invite.status}`);
  if (new Date(invite.expires_at) < new Date()) {
    await supabaseAdmin.from('invitations').update({ status: 'EXPIRED' }).eq('id', invite.id);
    throw httpError(400, 'Invitation expired');
  }

  // 2. Create the Supabase auth user.
  const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
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

  // 3. Upsert the public.users row with the invited role.
  const { error: upsertErr } = await supabaseAdmin.from('users').upsert(
    {
      id: created.user.id,
      email: invite.email,
      full_name: full_name ?? null,
      role: invite.role,
    },
    { onConflict: 'id' }
  );
  if (upsertErr) throw httpError(500, upsertErr.message);

  // 4. Mark the invitation as accepted.
  await supabaseAdmin
    .from('invitations')
    .update({ status: 'ACCEPTED', accepted_at: new Date().toISOString() })
    .eq('id', invite.id);

  res.status(201).json({ email: invite.email, role: invite.role });
};

export const revoke: RequestHandler = async (req, res) => {
  const { id } = req.params;
  const { error } = await supabaseAdmin
    .from('invitations')
    .update({ status: 'REVOKED' })
    .eq('id', id);
  if (error) throw httpError(500, error.message);
  res.json({ ok: true });
};
