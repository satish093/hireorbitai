import type { Request } from 'express';
import { db } from '../config/db';
import { env } from '../config/env';
import { httpError, Role } from '../types';
import {
  generateTempPassword,
  generateResetToken,
  hashToken,
  validatePasswordStrength,
} from '../utils/password';
import { audit } from './audit.service';
import { publishToUser } from './realtime.service';
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

type AccountStatus = 'active' | 'inactive' | 'suspended' | 'pending_verification' | 'banned';

interface UserRow {
  id: string;
  email: string;
  full_name: string | null;
  role: Role;
  is_active: boolean;
  status: AccountStatus | null;
  must_change_password: boolean;
  temporary_password_sent_at: string | null;
  failed_login_attempts: number;
  locked_until: string | null;
}

const USER_ROW_COLS =
  'id,email,full_name,role,is_active,status,must_change_password,temporary_password_sent_at,failed_login_attempts,locked_until';

async function loadUserByEmail(email: string): Promise<UserRow | null> {
  // .eq() instead of .ilike() — wildcards (`%`, `_`) are RFC-legal in the
  // local part of an email and Zod's email() validator permits them, so the
  // previous ILIKE lookup would match `admin%@example.com` against the seed
  // SUPER_ADMIN and let an unauthenticated attacker target lockout / brute-
  // force their account. Callers always normalize to lowercase upstream
  // (`email.trim().toLowerCase()`), and we additionally lowercase here as
  // defense in depth so a future caller can't bypass by mixed-case.
  const norm = email.trim().toLowerCase();
  const { data, error } = await db
    .from('users')
    .select(USER_ROW_COLS)
    .eq('email', norm)
    .maybeSingle();
  if (error) throw httpError(500, 'Database error');
  return data as UserRow | null;
}

async function loadUserById(id: string): Promise<UserRow | null> {
  const { data, error } = await db.from('users').select(USER_ROW_COLS).eq('id', id).maybeSingle();
  if (error) throw httpError(500, 'Database error');
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

export async function login(email: string, password: string, req: Request): Promise<LoginResult> {
  const norm = email.trim().toLowerCase();
  const user = await loadUserByEmail(norm);

  // Lockout check — short-circuit before we even verify the password.
  if (user?.locked_until && new Date(user.locked_until) > new Date()) {
    audit({ action: 'login_blocked_locked', user_id: user.id, email: norm, req });
    throw httpError(423, 'Account is temporarily locked. Try again later.');
  }

  // Verify the password via the local auth module (the source of truth for
  // password storage — bcrypt-hashed in public.users.password_hash).
  const { data, error } = await db.auth.signInWithPassword({
    email: norm,
    password,
  });

  if (error || !data.session || !data.user) {
    if (user) {
      await bumpFailedLogins(user, req);
    } else {
      // Don't leak whether the email is known. Still audit with email-only.
      audit({
        action: 'login_failed',
        email: norm,
        req,
        metadata: { reason: 'unknown_email_or_bad_pw' },
      });
    }
    throw httpError(401, 'Invalid email or password.');
  }

  // Even if the auth module returned a session, we still gate against our app's
  // public.users row — if it's missing, the user is half-provisioned and
  // can't be admitted.
  const profile = user ?? (await loadUserById(data.user.id));
  if (!profile) {
    audit({
      action: 'login_failed',
      user_id: data.user.id,
      email: norm,
      req,
      metadata: { reason: 'no_profile_row' },
    });
    throw httpError(403, 'Account is not provisioned. Contact an administrator.');
  }

  // Status gate. `active` = OK, anything else refuses sign-in. We surface
  // a specific message so the user knows whether they're suspended,
  // pending verification, etc. Defense in depth: revoke any lingering
  // refresh tokens for non-active accounts.
  const status = profile.status ?? (profile.is_active === false ? 'inactive' : 'active');
  if (status !== 'active') {
    void db.auth.admin.signOut(profile.id, 'global').catch(() => {});
    audit({
      action: 'login_failed',
      user_id: profile.id,
      email: norm,
      req,
      metadata: { reason: `status_${status}` },
    });
    const messages: Record<string, string> = {
      inactive: 'This account is inactive. Contact an administrator.',
      suspended: 'This account is suspended. Contact an administrator.',
      banned: 'This account has been banned.',
      pending_verification:
        "Your account is awaiting verification. We'll email you when it's ready.",
    };
    throw httpError(403, messages[status] ?? 'This account is not active.');
  }

  // Temp-password expiry check — if `must_change_password` is set and the
  // temp was issued more than TEMP_PASSWORD_EXPIRY_HOURS ago, refuse the
  // login (the admin must re-issue).
  if (profile.must_change_password && profile.temporary_password_sent_at) {
    const ageMs = Date.now() - new Date(profile.temporary_password_sent_at).getTime();
    const ttlMs = env.tempPasswordExpiryHours * 3600 * 1000;
    if (ageMs > ttlMs) {
      audit({
        action: 'login_failed',
        user_id: profile.id,
        email: norm,
        req,
        metadata: { reason: 'temp_password_expired' },
      });
      throw httpError(
        403,
        'Your temporary password has expired. Ask an administrator to re-issue one.',
      );
    }
  }

  // On a clean success: reset failure counters AND stamp last_login_at so
  // the admin user list can show "last active". Combined into one UPDATE.
  await db
    .from('users')
    .update({
      failed_login_attempts: 0,
      locked_until: null,
      last_login_at: new Date().toISOString(),
    })
    .eq('id', profile.id);

  audit({
    action: 'login_success',
    user_id: profile.id,
    email: profile.email,
    req,
    metadata: { must_change_password: profile.must_change_password },
  });
  if (profile.must_change_password) {
    audit({
      action: 'must_change_password_enforced',
      user_id: profile.id,
      email: profile.email,
      req,
    });
  }

  // Kick any other devices that still have an open SSE connection. The
  // session_version bump already invalidates their JWTs server-side; this
  // makes the logout immediate rather than waiting for their next API call.
  void publishToUser(profile.id, 'session:revoked', { reason: 'new_login' }).catch(() => {});

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
    audit({
      action: 'account_locked',
      user_id: user.id,
      email: user.email,
      req,
      metadata: { attempts: next, unlocks_at: unlocksAt.toISOString() },
    });
    // Fire the email asynchronously — never block the login response.
    void sendAccountLockedNotice({
      to: { email: user.email, name: user.full_name ?? undefined },
      unlocksAt,
    }).catch((err) => logger.warn({ err }, 'lockout email failed'));
  }
  await db.from('users').update(update).eq('id', user.id);
  audit({
    action: 'login_failed',
    user_id: user.id,
    email: user.email,
    req,
    metadata: { attempts: next },
  });
}

// ---------------------------------------------------------------------------
// LOGOUT
// ---------------------------------------------------------------------------
export async function logout(userId: string, req: Request): Promise<void> {
  // `scope: 'global'` revokes every refresh token for the user (this device + all others).
  // For a single-device logout, pass 'local' or call signOut with the access token.
  await db.auth.admin.signOut(userId, 'global');
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
  const { error: verifyErr } = await db.auth.signInWithPassword({
    email,
    password: currentPassword,
  });
  if (verifyErr) {
    audit({
      action: 'login_failed',
      user_id: userId,
      email,
      req,
      metadata: { reason: 'change_password_verify_failed' },
    });
    throw httpError(401, 'Current password is incorrect.');
  }

  // Update the password via the admin API.
  const { error: updErr } = await db.auth.admin.updateUserById(userId, {
    password: newPassword,
  });
  if (updErr) throw httpError(500, updErr.message);

  // Invalidate every existing session for this user.
  await db.auth.admin.signOut(userId, 'global');

  // Mark the profile as cleared from first-login flag.
  await db
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
  const fresh = await db.auth.signInWithPassword({ email, password: newPassword });
  if (fresh.error || !fresh.data.session) {
    throw httpError(
      500,
      'Password updated, but failed to issue a new session. Please sign in again.',
    );
  }

  audit({ action: 'password_changed', user_id: userId, email, req });
  // brevo.service's `to.name` is already optional (`name?: string`). Just
  // omit it — no need to fake a null through a double-cast. The email
  // template falls back to "Hi there" when name is missing.
  void sendPasswordChangedNotice({
    to: { email },
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

  if (!user || user.is_active === false) {
    // Pad to ~150ms so attackers can't distinguish hits vs misses by timing.
    // Deactivated accounts are treated identically to "unknown email" — no
    // token is issued, no email is sent, but the client still sees 200.
    await sleep(150);
    audit({
      action: 'password_reset_requested',
      email: norm,
      req,
      metadata: { existed: !!user, deactivated: user?.is_active === false },
    });
    return;
  }

  // Anti-enumeration: every error path below MUST be swallowed. If insert or
  // Brevo fails we'd otherwise return 500 for existing users and 200 for
  // unknown ones — letting attackers enumerate accounts by observing status.
  try {
    // Invalidate any prior unused tokens for this user so only the freshest
    // link works. Prevents reset-link accumulation across repeated requests.
    await db
      .from('password_reset_tokens')
      .update({ used_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .is('used_at', null);

    const raw = generateResetToken();
    const expires = new Date(Date.now() + env.resetTokenExpiryMinutes * 60 * 1000);
    const { error } = await db.from('password_reset_tokens').insert({
      user_id: user.id,
      token_hash: hashToken(raw),
      expires_at: expires.toISOString(),
      ip_address: req.ip ?? null,
    });
    if (error) {
      logger.error({ err: error, user_id: user.id }, 'failed to insert password_reset_tokens row');
      audit({
        action: 'password_reset_requested',
        user_id: user.id,
        email: user.email,
        req,
        metadata: { existed: true, delivered: false, reason: 'insert_failed' },
      });
      return;
    }

    const resetUrl = `${env.frontendUrl}/reset-password?token=${encodeURIComponent(raw)}`;
    try {
      await sendPasswordResetLink({
        to: { email: user.email, name: user.full_name ?? undefined },
        resetUrl,
        expiresInMinutes: env.resetTokenExpiryMinutes,
      });
      audit({
        action: 'password_reset_requested',
        user_id: user.id,
        email: user.email,
        req,
        metadata: { existed: true, delivered: true },
      });
    } catch (mailErr) {
      logger.error({ err: mailErr, user_id: user.id }, 'failed to send password reset email');
      audit({
        action: 'password_reset_requested',
        user_id: user.id,
        email: user.email,
        req,
        metadata: { existed: true, delivered: false, reason: 'mail_failed' },
      });
    }
  } catch (e) {
    // Catch-all to preserve the anti-enumeration invariant.
    logger.error({ err: e, user_id: user.id }, 'unexpected error in requestPasswordReset');
    audit({
      action: 'password_reset_requested',
      user_id: user.id,
      email: user.email,
      req,
      metadata: { existed: true, delivered: false, reason: 'unexpected' },
    });
  }
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
  const { data: row, error } = await db
    .from('password_reset_tokens')
    .select('id,user_id,expires_at,used_at')
    .eq('token_hash', tokenHash)
    .maybeSingle();
  if (error) throw httpError(500, 'Database error');

  if (!row) {
    audit({
      action: 'password_reset_invalid_token',
      req: args.req,
      metadata: { reason: 'not_found' },
    });
    throw httpError(400, 'Reset link is invalid or has expired.');
  }
  if (row.used_at) {
    audit({
      action: 'password_reset_invalid_token',
      user_id: row.user_id,
      req: args.req,
      metadata: { reason: 'already_used' },
    });
    throw httpError(400, 'Reset link has already been used.');
  }
  if (new Date(row.expires_at) < new Date()) {
    audit({
      action: 'password_reset_invalid_token',
      user_id: row.user_id,
      req: args.req,
      metadata: { reason: 'expired' },
    });
    throw httpError(400, 'Reset link is invalid or has expired.');
  }

  // Load the user so we can email + audit against email + run strength
  // validation against their email local-part.
  const user = await loadUserById(row.user_id);
  if (!user) throw httpError(500, 'User row missing for reset token');

  // Refuse to complete the reset if the account has been deactivated since
  // the token was issued. The login flow already blocks deactivated accounts,
  // but rotating the password under their feet would be a confusing signal.
  if (user.is_active === false) {
    audit({
      action: 'password_reset_invalid_token',
      user_id: user.id,
      req: args.req,
      metadata: { reason: 'account_deactivated' },
    });
    throw httpError(403, 'This account has been deactivated. Contact an administrator.');
  }

  const strength = validatePasswordStrength(args.newPassword, { email: user.email });
  if (!strength.ok) throw httpError(400, strength.problems.join(' '));

  // Update the password + revoke all sessions atomically (from the client's POV).
  const { error: updErr } = await db.auth.admin.updateUserById(row.user_id, {
    password: args.newPassword,
  });
  if (updErr) throw httpError(500, updErr.message);
  await db.auth.admin.signOut(row.user_id, 'global');

  // Mark token used (we keep the row for audit; the purge function in SQL
  // cleans it up after 7 days). Also clear must_change_password since the
  // user has demonstrably re-authenticated.
  await db
    .from('password_reset_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('id', row.id);
  await db
    .from('users')
    .update({
      must_change_password: false,
      last_password_changed_at: new Date().toISOString(),
      failed_login_attempts: 0,
      locked_until: null,
    })
    .eq('id', row.user_id);

  audit({
    action: 'password_reset_completed',
    user_id: row.user_id,
    email: user.email,
    req: args.req,
  });
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

  // 1. Create the auth user. `email_confirm: true` is a no-op flag retained for
  //    API compatibility — every email path runs through Brevo.
  const { data: created, error: createErr } = await db.auth.admin.createUser({
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
  const { error: profileErr } = await db.from('users').upsert(
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
    await db.auth.admin.deleteUser(created.user.id).catch(() => {});
    throw httpError(500, profileErr.message);
  }

  // 3. Send the welcome email with the temp password. Done synchronously so
  //    the admin gets an immediate error if Brevo fails — better than
  //    silently creating an account whose owner never gets credentials.
  //    If Brevo fails, roll back both the public.users row and the auth user
  //    so the admin doesn't end up with an orphaned account whose temp
  //    password they can no longer recover.
  try {
    await sendWelcomeWithTempPassword({
      to: { email: norm, name: args.fullName ?? undefined },
      tempPassword,
      expiresInHours: env.tempPasswordExpiryHours,
    });
  } catch (mailErr) {
    await db
      .from('users')
      .delete()
      .eq('id', created.user.id)
      .then(
        () => {},
        () => {},
      );
    await db.auth.admin.deleteUser(created.user.id).catch(() => {});
    const msg = mailErr instanceof Error ? mailErr.message : 'Failed to send welcome email';
    throw httpError(502, `Account was not created: ${msg}`);
  }

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

// ---------------------------------------------------------------------------
// LIFECYCLE — single source of truth for account status changes.
//
// Both the admin surface (`/admin/users/:id/status`) and the legacy
// (`/users/:id/deactivate`, `/users/:id/reactivate`) routes funnel through
// here so the two persisted fields stay in lockstep:
//
//   status (5-state enum) ──── what middleware reads
//   is_active (boolean)   ──── legacy column, kept in sync for back-compat
//
// Anything other than `active` revokes the user's refresh tokens so an in-
// flight access token dies at its TTL and refresh stops working immediately.
// Always audit-logged.
// ---------------------------------------------------------------------------
export type AccountStatusValue =
  | 'active'
  | 'inactive'
  | 'suspended'
  | 'pending_verification'
  | 'banned';

export async function setUserStatus(args: {
  targetId: string;
  status: AccountStatusValue;
  reason?: string | null;
  actor: { id: string; email: string };
  req: Request;
}): Promise<{
  id: string;
  email: string;
  status: AccountStatusValue;
  status_reason: string | null;
  is_active: boolean;
}> {
  const { targetId, status, reason, actor, req } = args;

  // Snapshot the previous state for the audit metadata.
  const { data: before, error: lookupErr } = await db
    .from('users')
    .select('id, email, status, is_active')
    .eq('id', targetId)
    .maybeSingle();
  if (lookupErr) throw httpError(500, lookupErr.message);
  if (!before) throw httpError(404, 'User not found');

  const now = new Date().toISOString();
  const { data, error } = await db
    .from('users')
    .update({
      status,
      // Reason only makes sense for non-active states. On reactivate we
      // explicitly null it out so the old reason doesn't linger as a stale
      // "this account was suspended because…" footer on a now-active user.
      status_reason: status === 'active' ? null : (reason ?? null),
      status_changed_at: now,
      status_changed_by: actor.id,
      // Keep the legacy is_active column in sync. New code reads `status`,
      // but a few legacy queries (and the schema-cache fallback in the auth
      // middleware) still rely on the boolean.
      is_active: status === 'active',
      updated_at: now,
    })
    .eq('id', targetId)
    .select('id, email, status, status_reason, is_active')
    .single();
  if (error) throw httpError(500, 'Database error');

  // Revoke ALL refresh tokens whenever the user leaves the active state.
  // The access-token TTL is short (≤ 1h by default) so the in-flight token
  // ages out on its own; refresh is dead immediately.
  if (status !== 'active') {
    await db.auth.admin.signOut(targetId, 'global').catch((err) => {
      logger.warn({ err, targetId }, 'lifecycle: signOut failed');
    });
  }

  audit({
    action: status === 'active' ? 'admin_user_reactivated' : 'admin_user_deactivated',
    user_id: targetId,
    email: data.email,
    req,
    metadata: {
      from_status: before.status ?? (before.is_active === false ? 'inactive' : 'active'),
      to_status: status,
      reason: reason ?? null,
      by: actor.id,
    },
  });

  return data as {
    id: string;
    email: string;
    status: AccountStatusValue;
    status_reason: string | null;
    is_active: boolean;
  };
}
