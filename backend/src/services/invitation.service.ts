import crypto from 'crypto';
import { supabaseAdmin } from '../config/supabase';
import { sendEmail } from '../config/email';
import { env } from '../config/env';
import { Role, httpError } from '../types';

interface CreateInvitationInput {
  email: string;
  role: Role;
  invitedBy: string;
}

/**
 * Create an invitation row + send the invite email.
 *
 * Email delivery strategy (in order):
 *   1. Supabase Auth's built-in invite email — `auth.admin.inviteUserByEmail`.
 *      This uses the project's configured SMTP (defaults to Supabase's free
 *      service) and the "Invite User" email template. Recipient clicks → lands
 *      on /invite/accept?token=… with a temporary auth session, so they can
 *      set a password without us managing the email at all. Works out of the
 *      box, no external provider needed.
 *   2. Fallback: our own Resend send — only used when (a) Supabase invite
 *      fails (typically because the auth user already exists) or (b) we
 *      explicitly want a branded email.
 */
export async function createInvitation(input: CreateInvitationInput) {
  const token = crypto.randomBytes(24).toString('hex');
  const expiresAt = new Date(Date.now() + env.invitationExpiryHours * 3600 * 1000).toISOString();

  const { data, error } = await supabaseAdmin
    .from('invitations')
    .insert({
      email: input.email.toLowerCase(),
      role: input.role,
      token,
      invited_by: input.invitedBy,
      expires_at: expiresAt,
    })
    .select()
    .single();
  if (error) throw httpError(500, error.message);

  const inviteUrl = `${env.appUrl}/invite/accept?token=${token}`;
  let email_sent = false;
  let email_error: string | undefined;
  let delivery: 'supabase_invite' | 'resend' | 'none' = 'none';

  // Primary: Supabase Auth invite email.
  try {
    const { error: inviteErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(
      input.email,
      {
        redirectTo: inviteUrl,
        data: { invited_role: input.role, invitation_token: token },
      }
    );
    if (inviteErr) throw inviteErr;
    email_sent = true;
    delivery = 'supabase_invite';
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    // If a user with this email already exists in auth.users, Supabase refuses
    // to send a fresh invite. Fall through to Resend so the existing user can
    // still get a link.
    const userExists = /already (been )?registered|already exists|exists/i.test(msg);
    if (!userExists) email_error = msg;

    // Fallback: try Resend (will silently no-op if API key isn't configured).
    try {
      await sendEmail({
        to: input.email,
        subject: "You're invited to HireOrbit AI",
        html: `<div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0f172a">
                 <h2 style="margin:0 0 16px">Welcome to HireOrbit AI</h2>
                 <p>You've been invited to join <strong>HireOrbit AI</strong> as <strong>${input.role}</strong>.</p>
                 <p style="margin:24px 0">
                   <a href="${inviteUrl}" style="background:#4f46e5;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;display:inline-block">Accept your invitation</a>
                 </p>
                 <p style="color:#475569;font-size:13px">This link expires in ${env.invitationExpiryHours} hours. If the button doesn't work, paste this URL into your browser:<br/><span style="color:#0f172a">${inviteUrl}</span></p>
                 <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0"/>
                 <p style="color:#94a3b8;font-size:12px">If you didn't expect this invitation you can safely ignore this email.</p>
               </div>`,
      });
      email_sent = true;
      email_error = undefined;
      delivery = 'resend';
    } catch (e2) {
      const m = e2 instanceof Error ? e2.message : String(e2);
      // Prefer the first (Supabase) error if we already have one — it's the
      // primary failure to surface.
      email_error = email_error ?? m;
      // eslint-disable-next-line no-console
      console.warn(`[invitations] email send failed for ${input.email}: supabase=${msg} resend=${m}`);
    }
  }

  return { ...data, invite_url: inviteUrl, email_sent, email_error, delivery };
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
      `This invitation is for ${invite.email}. Sign out and open the link in an incognito window, or send a new invite to ${actor.email}.`
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
