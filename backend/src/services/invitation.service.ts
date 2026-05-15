import crypto from 'node:crypto';
import { supabaseAdmin } from '../config/supabase';
import { sendInvitationLink } from './brevo.service';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { Role, httpError } from '../types';

interface CreateInvitationInput {
  email: string;
  role: Role;
  invitedBy: string;
}

/**
 * Create an invitation row + send the invite email through Brevo.
 *
 * The previous version of this service fell through Supabase's
 * `auth.admin.inviteUserByEmail` (which uses Supabase's SMTP). That path is
 * removed — per the auth spec, NO emails go through Supabase. Every
 * transactional message is sent through our Brevo client so the sender,
 * branding, and deliverability are under our control.
 *
 * Failure modes are surfaced (not swallowed) so the API caller can react —
 * the row is still inserted on email failure, but `email_sent: false` lets
 * the UI show the "Copy invite link" affordance instead of pretending
 * delivery succeeded.
 */
export async function createInvitation(input: CreateInvitationInput) {
  const token = crypto.randomBytes(24).toString('hex');
  const expiresAt = new Date(Date.now() + env.invitationExpiryHours * 3600 * 1000).toISOString();
  const emailLc = input.email.trim().toLowerCase();

  const { data, error } = await supabaseAdmin
    .from('invitations')
    .insert({
      email: emailLc,
      role: input.role,
      token,
      invited_by: input.invitedBy,
      expires_at: expiresAt,
    })
    .select()
    .single();
  if (error) throw httpError(500, error.message);

  // Resolve who's inviting them, so the email reads "Satish invited you…"
  // rather than the generic "A teammate invited you…".
  let invitedByName: string | undefined;
  if (input.invitedBy) {
    const { data: inviter } = await supabaseAdmin
      .from('users')
      .select('full_name, email')
      .eq('id', input.invitedBy)
      .maybeSingle();
    if (inviter) invitedByName = inviter.full_name ?? inviter.email ?? undefined;
  }

  const inviteUrl = `${env.frontendUrl}/invite/accept?token=${token}`;
  let email_sent = false;
  let email_error: string | undefined;

  try {
    await sendInvitationLink({
      to: { email: emailLc },
      role: input.role,
      inviteUrl,
      expiresInHours: env.invitationExpiryHours,
      invitedByName,
    });
    email_sent = true;
  } catch (e: unknown) {
    email_error = e instanceof Error ? e.message : String(e);
    logger.warn({ err: email_error, recipient: emailLc }, 'invitation Brevo send failed');
  }

  return {
    ...data,
    invite_url: inviteUrl,
    email_sent,
    email_error,
    delivery: email_sent ? 'brevo' : 'none',
  };
}

export async function acceptInvitation(token: string, userId: string) {
  const { data: invite, error } = await supabaseAdmin
    .from('invitations')
    .select('*')
    .eq('token', token)
    .single();
  if (error || !invite) throw httpError(404, 'Invitation not found');
  if (invite.status !== 'PENDING') throw httpError(400, `Invitation already ${invite.status}`);
  if (new Date(invite.expires_at) < new Date()) {
    await supabaseAdmin.from('invitations').update({ status: 'EXPIRED' }).eq('id', invite.id);
    throw httpError(400, 'Invitation expired');
  }

  // Guardrail: the invitation is for a specific email — reject if the logged-in
  // user isn't that recipient. Without this, anyone clicking the invite link
  // while signed in as another user would have their role overwritten.
  const { data: actor } = await supabaseAdmin
    .from('users').select('email, role').eq('id', userId).single();
  if (!actor) throw httpError(403, 'Caller not found');
  if (actor.email.toLowerCase() !== invite.email.toLowerCase()) {
    throw httpError(
      403,
      `This invitation is for ${invite.email}. Sign out and open the link in an incognito window, or send a new invite to ${actor.email}.`,
    );
  }

  // Promote the user's role and mark accepted.
  await supabaseAdmin.from('users').update({ role: invite.role }).eq('id', userId);
  await supabaseAdmin
    .from('invitations')
    .update({ status: 'ACCEPTED', accepted_at: new Date().toISOString() })
    .eq('id', invite.id);

  return { role: invite.role };
}
