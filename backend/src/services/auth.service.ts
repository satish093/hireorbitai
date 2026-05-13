import type { Request } from 'express';
import { supabaseAdmin, supabaseAnon } from '../config/supabase';
import { env } from '../config/env';
import { httpError, Role } from '../types';
import {
  generateTempPassword,
  generateResetToken,
  hashToken,
  validatePasswordStrength,
} from '../utils/password';
import { audit } from './audit.service';
import {
  sendWelcomeWithTempPassword,
  sendPasswordResetLink,
  sendPasswordChangedNotice,
  sendAccountLockedNotice,
} from './brevo.service';
import { logger } from '../config/logger';

// ---------------------------------------------------------------------------
// Login outcomes — surfaced to the controller so it can shape the HTTP
// response (200 with `must_change_password=true` vs 423 locked vs 401 bad).
// ---------------------------------------------------------------------------

interface UserRow {
  id: string;
  email: string;
  full_name: string | null;
  role: Role;
  must_change_password: boolean;
  temporary_password_sent_at: string | null;
  failed_login_attempts: number;
  locked_until: string | null;
}

async function loadUserByEmail(email: string): Promise<UserRow | null> {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('id,email,full_name,role,must_change_password,temporary_password_sent_at,failed_login_attempts,locked_until')
    .ilike('email', email)
    .maybeSingle();
  if (error) throw httpError(500, error.message);
  return data as UserRow | null;
}

async function loadUserById(id: string): Promise<UserRow | null> {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('id,email,full_name,role,must_change_password,temporary_password_sent_at,failed_login_attempts,locked_until')
    .eq('id', id)
    .maybeSingle();
  if (error) throw httpError(500, error.message);
  return data as UserRow | null;
}

// ---------------------------------------------------------------------------
// LOGIN
//
// We never reveal whether an email exists in the system — every "wrong" path
// returns the same generic 401 message. Lockout state and temp-password
// expiry are surfaced only to users who supplied a valid email + password.
// ---------------------------------------------------------------------------

export interface LoginResult {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user: {
    id: string;
    email: string;
    full_name: string | null;
    role: Role;
  };
  must_change_password: boolean;
}

export async function login(
  email: string,
  password: string,
  req: Request,
): Promise<LoginResult> {
  const norm = email.trim().toLowerCase();
  const user = await loadUserByEmail(norm);

  // Lockout check — short-circuit before we even hit Supabase Auth.
  if (user?.locked_until && new Date(user.locked_until) > new Date()) {
    audit({ action: 'login_blocked_locked', user_id: user.id, email: norm, req });
    throw httpError(423, 'Account is temporarily locked. Try again later.');
  }

  // Verify the password via Supabase Auth (the source of truth for password
  // storage). IMPORTANT: use the anon-key client, NOT supabaseAdmin —
  // signInWithPassword mutates the client's auth state, which would replace
  // the service-role key with the user's JWT on every subsequent admin call
  // (and RLS would silently filter out our writes).
  const { data, error } = await supabaseAnon.auth.signInWithPassword({
    email: norm,
    password,
  });

  if (error || !data.session || !data.user) {
    if (user) {
      await bumpFailedLogins(user, req);
    } else {
      // Don't leak whether the email is known. Still audit with email-only.
      audit({ action: 'login_failed', email: norm, req, metadata: { reason: 'unknown_email_or_bad_pw' } });
    }
    throw httpError(401, 'Invalid email or password.');
  }

  // Even if Supabase returned a session, we still gate against our app's
  // public.users row — if it's missing, the user is half-provisioned and
  // can't be admitted.
  const profile = user ?? (await loadUserById(data.user.id));
  if (!profile) {
    audit({ action: 'login_failed', user_id: data.user.id, email: norm, req, metadata: { reason: 'no_profile_row' } });
    throw httpError(403, 'Account is not provisioned. Contact an administrator.');
  }

  // Temp-password expiry check — if `must_change_password` is set and the
  // temp was issued more than TEMP_PASSWORD_EXPIRY_HOURS ago, refuse the
  // login (the admin must re-issue).
  if (profile.must_change_password && profile.temporary_password_sent_at) {
    const ageMs = Date.now() - new Date(profile.temporary_password_sent_at).getTime();
    const ttlMs = env.tempPasswordExpiryHours * 3600 * 1000;
    if (ageMs > ttlMs) {
      audit({ action: 'login_failed', user_id: profile.id, email: norm, req, metadata: { reason: 'temp_password_expired' } });
      throw httpError(403, 'Your temporary password has expired. Ask an administrator to re-issue one.');
    }
  }

  // Reset the failed-login counter on a clean success.
  if (profile.failed_login_attempts > 0 || profile.locked_until) {
    await supabaseAdmin
      .from('users')
      .update({ failed_login_attempts: 0, locked_until: null })
      .eq('id', profile.id);
  }

  audit({
    action: 'login_success',
    user_id: profile.id,
    email: profile.email,
    req,
    metadata: { must_change_password: profile.must_change_password },
  });
  if (profile.must_change_password) {
    audit({ action: 'must_change_password_enforced', user_id: profile.id, email: profile.email, req });
  }

  return {
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_at: data.session.expires_at ?? Math.floor(Date.now() / 1000) + 3600,
    user: {
      id: profile.id,
      email: profile.email,
      full_name: profile.full_name,
      role: profile.role,
    },
    must_change_password: profile.must_change_password,
  };
}

async function bumpFailedLogins(user: UserRow, req: Request): Promise<void> {
  const next = (user.failed_login_attempts ?? 0) + 1;
  const update: Record<string, unknown> = { failed_login_attempts: next };

  if (next >= env.maxFailedLogins) {
    const unlocksAt = new Date(Date.now() + env.lockoutMinutes * 60 * 1000);
    update.locked_until = unlocksAt.toISOString();
    audit({ action: 'account_locked', user_id: user.id, email: user.email, req, metadata: { attempts: next, unlocks_at: unlocksAt.toISOString() } });
    // Fire the email asynchronously — never block the login response.
    void sendAccountLockedNotice({
      to: { email: user.email, name: user.full_name ?? undefined },
      unlocksAt,
    }).catch((err) => logger.warn({ err }, 'lockout email failed'));
  }
  await supabaseAdmin.from('users').update(update).eq('id', user.id);
  audit({ action: 'login_failed', user_id: user.id, email: user.email, req, metadata: { attempts: next } });
}

// ---------------------------------------------------------------------------
// LOGOUT
// ---------------------------------------------------------------------------
export async function logout(userId: string, req: Request): Promise<void> {
  // `scope: 'global'` revokes every refresh token for the user (this device + all others).
  // For a single-device logout, pass 'local' or call signOut with the access token.
  await supabaseAdmin.auth.admin.signOut(userId, 'global');
  audit({ action: 'logout', user_id: userId, req });
}

// ---------------------------------------------------------------------------
// CHANGE PASSWORD — used by the forced first-login flow AND voluntary changes
// ---------------------------------------------------------------------------
export async function changePassword(args: {
  userId: string;
  email: string;
  currentPassword: string;
  newPassword: string;
  req: Request;
}): Promise<{ access_token: string; refresh_token: string; expires_at: number }> {
  const { userId, email, currentPassword, newPassword, req } = args;

  if (currentPassword === newPassword) {
    throw httpError(400, 'New password must be different from the current password.');
  }
  const strength = validatePasswordStrength(newPassword, { email });
  if (!strength.ok) throw httpError(400, strength.problems.join(' '));

  // Re-verify the current password by attempting a sign-in. This protects
  // against session theft scenarios where the bearer token is valid but the
  // user doesn't actually know the password.
  // Anon client, not admin — see the comment on login() above.
  const { error: verifyErr } = await supabaseAnon.auth.signInWithPassword({
    email,
    password: currentPassword,
  });
  if (verifyErr) {
    audit({ action: 'login_failed', user_id: userId, email, req, metadata: { reason: 'change_password_verify_failed' } });
    throw httpError(401, 'Current password is incorrect.');
  }

  // Update the password via the admin API.
  const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(userId, {
    password: newPassword,
  });
  if (updErr) throw httpError(500, updErr.message);

  // Invalidate every existing session for this user.
  await supabaseAdmin.auth.admin.signOut(userId, 'global');

  // Mark the profile as cleared from first-login flag.
  await supabaseAdmin
    .from('users')
    .update({
      must_change_password: false,
      last_password_changed_at: new Date().toISOString(),
      failed_login_attempts: 0,
      locked_until: null,
    })
    .eq('id', userId);

  // Issue a fresh session so the user stays signed in after rotation.
  // Anon client again — we just need the session pair to hand back.
  const fresh = await supabaseAnon.auth.signInWithPassword({ email, password: newPassword });
  if (fresh.error || !fresh.data.session) {
    throw httpError(500, 'Password updated, but failed to issue a new session. Please sign in again.');
  }

  audit({ action: 'password_changed', user_id: userId, email, req });
  void sendPasswordChangedNotice({
    to: { email, name: null as unknown as string },
    when: new Date(),
    ipAddress: req.ip ?? null,
  }).catch((err) => logger.warn({ err }, 'password-changed email failed'));

  return {
    access_token: fresh.data.session.access_token,
    refresh_token: fresh.data.session.refresh_token,
    expires_at: fresh.data.session.expires_at ?? Math.floor(Date.now() / 1000) + 3600,
  };
}

// ---------------------------------------------------------------------------
// FORGOT PASSWORD — generates a token, hashes it, emails the raw token.
//
// Anti-enumeration: regardless of whether the email exists, the controller
// returns a generic 200 to the client. The work below short-circuits to a
// no-op if the user isn't found. Timing is bounded by the constant work we
// do either way (sleep below).
// ---------------------------------------------------------------------------
export async function requestPasswordReset(email: string, req: Request): Promise<void> {
  const norm = email.trim().toLowerCase();
  const user = await loadUserByEmail(norm);

  if (!user) {
    // Pad to ~150ms so attackers can't distinguish hits vs misses by timing.
    await sleep(150);
    audit({ action: 'password_reset_requested', email: norm, req, metadata: { existed: false } });
    return;
  }

  const raw = generateResetToken();
  const expires = new Date(Date.now() + env.resetTokenExpiryMinutes * 60 * 1000);
  const { error } = await supabaseAdmin.from('password_reset_tokens').insert({
    user_id: user.id,
    token_hash: hashToken(raw),
    expires_at: expires.toISOString(),
    ip_address: req.ip ?? null,
  });
  if (error) {
    logger.error({ err: error }, 'failed to insert password_reset_tokens row');
    throw httpError(500, 'Could not start the password reset. Try again later.');
  }

  const resetUrl = `${env.frontendUrl}/reset-password?token=${encodeURIComponent(raw)}`;
  await sendPasswordResetLink({
    to: { email: user.email, name: user.full_name ?? undefined },
    resetUrl,
    expiresInMinutes: env.resetTokenExpiryMinutes,
  });

  audit({ action: 'password_reset_requested', user_id: user.id, email: user.email, req, metadata: { existed: true } });
}

// ---------------------------------------------------------------------------
// RESET PASSWORD — verifies the token, sets the new password.
// ---------------------------------------------------------------------------
export async function completePasswordReset(args: {
  token: string;
  newPassword: string;
  req: Request;
}): Promise<void> {
  const tokenHash = hashToken(args.token);
  const { data: row, error } = await supabaseAdmin
    .from('password_reset_tokens')
    .select('id,user_id,expires_at,used_at')
    .eq('token_hash', tokenHash)
    .maybeSingle();
  if (error) throw httpError(500, error.message);

  if (!row) {
    audit({ action: 'password_reset_invalid_token', req: args.req, metadata: { reason: 'not_found' } });
    throw httpError(400, 'Reset link is invalid or has expired.');
  }
  if (row.used_at) {
    audit({ action: 'password_reset_invalid_token', user_id: row.user_id, req: args.req, metadata: { reason: 'already_used' } });
    throw httpError(400, 'Reset link has already been used.');
  }
  if (new Date(row.expires_at) < new Date()) {
    audit({ action: 'password_reset_invalid_token', user_id: row.user_id, req: args.req, metadata: { reason: 'expired' } });
    throw httpError(400, 'Reset link is invalid or has expired.');
  }

  // Load the user so we can email + audit against email + run strength
  // validation against their email local-part.
  const user = await loadUserById(row.user_id);
  if (!user) throw httpError(500, 'User row missing for reset token');

  const strength = validatePasswordStrength(args.newPassword, { email: user.email });
  if (!strength.ok) throw httpError(400, strength.problems.join(' '));

  // Update the password + revoke all sessions atomically (from the client's POV).
  const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(row.user_id, {
    password: args.newPassword,
  });
  if (updErr) throw httpError(500, updErr.message);
  await supabaseAdmin.auth.admin.signOut(row.user_id, 'global');

  // Mark token used (we keep the row for audit; the purge function in SQL
  // cleans it up after 7 days). Also clear must_change_password since the
  // user has demonstrably re-authenticated.
  await supabaseAdmin
    .from('password_reset_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('id', row.id);
  await supabaseAdmin
    .from('users')
    .update({
      must_change_password: false,
      last_password_changed_at: new Date().toISOString(),
      failed_login_attempts: 0,
      locked_until: null,
    })
    .eq('id', row.user_id);

  audit({ action: 'password_reset_completed', user_id: row.user_id, email: user.email, req: args.req });
  void sendPasswordChangedNotice({
    to: { email: user.email, name: user.full_name ?? undefined },
    when: new Date(),
    ipAddress: args.req.ip ?? null,
  }).catch((err) => logger.warn({ err }, 'password-changed email failed'));
}

// ---------------------------------------------------------------------------
// ADMIN: create user with a temporary password
// ---------------------------------------------------------------------------
export async function adminCreateUser(args: {
  email: string;
  fullName?: string;
  role: Role;
  createdBy: { id: string; email: string };
  req: Request;
}): Promise<{ user_id: string }> {
  const norm = args.email.trim().toLowerCase();
  const tempPassword = generateTempPassword(16);

  // 1. Create the auth user. `email_confirm: true` skips the Supabase
  //    confirmation email — we do all email ourselves via Brevo.
  const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
    email: norm,
    password: tempPassword,
    email_confirm: true,
    user_metadata: {
      created_by: args.createdBy.id,
      full_name: args.fullName ?? null,
    },
  });
  if (createErr || !created?.user) {
    throw httpError(400, createErr?.message ?? 'Failed to create user');
  }

  // 2. Insert the matching public.users row.
  const now = new Date().toISOString();
  const { error: profileErr } = await supabaseAdmin
    .from('users')
    .upsert(
      {
        id: created.user.id,
        email: norm,
        full_name: args.fullName ?? null,
        role: args.role,
        must_change_password: true,
        temporary_password_sent_at: now,
        failed_login_attempts: 0,
      },
      { onConflict: 'id' },
    );
  if (profileErr) {
    // Roll back the auth user — otherwise we leave half-provisioned rows.
    await supabaseAdmin.auth.admin.deleteUser(created.user.id).catch(() => {});
    throw httpError(500, profileErr.message);
  }

  // 3. Send the welcome email with the temp password. Done synchronously so
  //    the admin gets an immediate error if Brevo fails — better than
  //    silently creating an account whose owner never gets credentials.
  await sendWelcomeWithTempPassword({
    to: { email: norm, name: args.fullName ?? undefined },
    tempPassword,
    expiresInHours: env.tempPasswordExpiryHours,
  });

  audit({
    action: 'admin_created_user',
    user_id: created.user.id,
    email: norm,
    req: args.req,
    metadata: { role: args.role, created_by: args.createdBy.id },
  });

  return { user_id: created.user.id };
}

function sleep(ms: number) {
  return new Promise<void>((res) => setTimeout(res, ms));
}
