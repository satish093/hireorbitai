import crypto from 'node:crypto';
import { db, pool } from '../config/db';
import { sendInvitationLink } from './brevo.service';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { Role, httpError } from '../types';
import { wireHierarchy } from './invitationHierarchy.service';

interface CreateInvitationInput {
  email: string;
  role: Role;
  invitedBy: string;
  // Optional pre-assigned group. null == "No Group" path; the new user lands
  // with users.group_id = NULL at acceptance.
  groupId?: string | null;
  // Parent assignment — auto-resolved or manually chosen by the inviter.
  parentUserId?: string | null;
  assignedMode?: 'auto' | 'manual';
  assignedBy?: string | null;
}

/**
 * Create an invitation row + send the invite email through Brevo.
 *
 * The previous version of this service fell through the third-party auth provider's
 * `inviteUserByEmail` API (which uses the provider's SMTP). That path is
 * removed — per the auth spec, NO emails go through any third party. Every
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

  // Block re-inviting an email that already has an account. Without this the
  // invite is created with no error and the dead-end is only hit at the final
  // step — db.auth.admin.createUser rejects the duplicate email and the invitee
  // gets a vague 400 AFTER filling out the whole form. Surface it now.
  const { data: existingUser } = await db
    .from('users')
    .select('id')
    .eq('email', emailLc)
    .maybeSingle();
  if (existingUser) {
    throw httpError(
      409,
      `${emailLc} already has an account. They can sign in or use “Forgot password” — no new invite is needed.`,
    );
  }

  const { data, error } = await db
    .from('invitations')
    .insert({
      email: emailLc,
      role: input.role,
      token,
      invited_by: input.invitedBy,
      group_id: input.groupId ?? null,
      expires_at: expiresAt,
      parent_user_id: input.parentUserId ?? null,
      assigned_mode: input.assignedMode ?? 'auto',
      assigned_by: input.assignedBy ?? null,
    })
    .select()
    .single();
  if (error) {
    // Schema may not have the new columns yet — retry without them
    if (/column .* does not exist|schema cache/i.test(error.message)) {
      const { data: legacy, error: legacyErr } = await db
        .from('invitations')
        .insert({
          email: emailLc,
          role: input.role,
          token,
          invited_by: input.invitedBy,
          group_id: input.groupId ?? null,
          expires_at: expiresAt,
        })
        .select()
        .single();
      if (legacyErr) throw httpError(500, legacyErr.message);
      return buildResponse(legacy, emailLc, token, input);
    }
    throw httpError(500, 'Database error');
  }

  return buildResponse(data, emailLc, token, input);
}

async function buildResponse(
  data: Record<string, unknown>,
  emailLc: string,
  token: string,
  input: CreateInvitationInput,
) {
  // Supersede any OTHER still-pending invitation for this email so only the
  // freshest link is valid — re-inviting is effectively "resend with a new
  // link". Best-effort: a failure here just leaves the old invite live (the
  // prior behaviour), it must not block issuing the new one.
  const newId = data?.id;
  if (newId) {
    await db
      .from('invitations')
      .update({ status: 'REVOKED' })
      .eq('email', emailLc)
      .eq('status', 'PENDING')
      .neq('id', String(newId))
      .then(
        () => undefined,
        (err: unknown) => {
          logger.warn(
            { err, email: emailLc },
            'failed to supersede prior pending invitations (non-fatal)',
          );
        },
      );
  }

  let invitedByName: string | undefined;
  if (input.invitedBy) {
    const { data: inviter } = await db
      .from('users')
      .select('full_name, email')
      .eq('id', input.invitedBy)
      .maybeSingle();
    if (inviter) invitedByName = (inviter as any).full_name ?? (inviter as any).email ?? undefined;
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

  // Guardrail: the invitation is for a specific email — reject if the logged-in
  // user isn't that recipient. Without this, anyone clicking the invite link
  // while signed in as another user would have their role overwritten.
  const { data: actor } = await db.from('users').select('email, role').eq('id', userId).single();
  if (!actor) throw httpError(403, 'Caller not found');
  if ((actor as any).email.toLowerCase() !== invite.email.toLowerCase()) {
    throw httpError(
      403,
      `This invitation is for ${invite.email}. Sign out and open the link in an incognito window, or send a new invite to ${(actor as any).email}.`,
    );
  }

  // Atomically claim the invitation BEFORE mutating the user row. Without
  // this CAS, two concurrent accept clicks both read status=PENDING above
  // and both proceed to role-promote + wireHierarchy. Only the winner of
  // the UPDATE…WHERE status='PENDING' continues.
  const claim = await pool.query<{ id: string }>(
    `UPDATE public.invitations
        SET status = 'ACCEPTED', accepted_at = $2
      WHERE id = $1 AND status = 'PENDING'
      RETURNING id`,
    [invite.id, new Date().toISOString()],
  );
  if (claim.rows.length === 0) {
    throw httpError(400, 'Invitation already accepted');
  }

  // Promote the user's role and, if the invitation pre-assigned a group,
  // move the user into it. Null group_id on the invitation leaves the user's
  // existing group untouched (no "demotion to No Group" surprises).
  const userPatch: Record<string, unknown> = { role: invite.role };
  if (invite.group_id) userPatch.group_id = invite.group_id;
  await db.from('users').update(userPatch).eq('id', userId);

  // Wire the org-hierarchy relationships now that the user exists with their role
  await wireHierarchy(userId, invite.role as Role, invite.parent_user_id ?? null).catch(
    (err: unknown) => {
      logger.warn(
        { err, userId, role: invite.role, parentUserId: invite.parent_user_id },
        'hierarchy wiring failed on invitation accept — user created, hierarchy needs manual fix',
      );
    },
  );

  return { role: invite.role, group_id: invite.group_id ?? null };
}
