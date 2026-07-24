import { db } from './db';
import type { AuthUser } from './auth.local';
import { env } from './env';
import { logger } from './logger';

/**
 * Opt-in default-admin provisioner. Triggered from server.ts ONLY when
 * `ENABLE_DEFAULT_ADMIN=true`. The canonical path for production is the
 * Node helper script (`npm run bootstrap:admin`); this exists for ephemeral
 * environments (CI, throwaway preview boxes) where you want an admin to be
 * waiting the moment the API comes up.
 *
 * Hard constraints:
 *   1. No hardcoded credentials in source. Both `DEFAULT_ADMIN_EMAIL` and
 *      `DEFAULT_ADMIN_PASSWORD` MUST be supplied via env. Missing either is
 *      a refuse-to-bootstrap condition (logged + bailed, never silently
 *      defaults).
 *   2. The seeded password is always armed with `must_change_password=true`,
 *      so it dies the moment the first human signs in.
 *   3. `DEFAULT_ADMIN_RESET=true` rotates the password back to the
 *      env-provided value + re-arms must_change. Useful for "I lost the
 *      admin" recovery in a sealed env.
 *
 * Failures are logged but never thrown — the API stays up even if bootstrap
 * can't provision the row.
 */
export async function ensureDefaultAdmin(): Promise<void> {
  const email = (process.env.DEFAULT_ADMIN_EMAIL ?? '').trim().toLowerCase();
  const password = process.env.DEFAULT_ADMIN_PASSWORD ?? '';
  const name = (process.env.DEFAULT_ADMIN_NAME ?? '').trim() || null;
  const role = (process.env.DEFAULT_ADMIN_ROLE ?? 'SUPER_ADMIN').trim();
  const reset = process.env.DEFAULT_ADMIN_RESET === 'true';

  if (!email || !password) {
    logger.warn(
      'default-admin bootstrap skipped — DEFAULT_ADMIN_EMAIL and DEFAULT_ADMIN_PASSWORD must both be set when ENABLE_DEFAULT_ADMIN=true',
    );
    return;
  }
  if (!/^.+@.+\..+$/.test(email)) {
    logger.warn(
      { email },
      'default-admin bootstrap skipped — DEFAULT_ADMIN_EMAIL is not a valid email',
    );
    return;
  }
  if (password.length < 12) {
    logger.warn(
      'default-admin bootstrap skipped — DEFAULT_ADMIN_PASSWORD must be at least 12 characters',
    );
    return;
  }

  try {
    const { data: list, error: lookupErr } = await db.auth.admin.listUsers();
    if (lookupErr) {
      logger.warn(
        { err: lookupErr.message },
        'default-admin: listUsers failed; skipping bootstrap',
      );
      return;
    }
    const existing = list.users.find((u: AuthUser) => (u.email ?? '').toLowerCase() === email);

    // Already provisioned with the right role? Bail unless explicit reset.
    if (existing) {
      const { data: profile } = await db
        .from('users')
        .select('id, role, must_change_password')
        .eq('id', existing.id)
        .maybeSingle();
      if (profile?.role === role && !reset) {
        logger.info(
          { email, userId: existing.id, role },
          'default-admin already provisioned — no action',
        );
        return;
      }
    }

    let userId: string;
    if (!existing) {
      const { data: created, error: createErr } = await db.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: name, bootstrap: true },
      });
      if (createErr || !created?.user) {
        logger.error({ err: createErr?.message }, 'default-admin: createUser failed');
        return;
      }
      userId = created.user.id;
      logger.info({ email, userId }, 'default-admin: created users row');
    } else {
      userId = existing.id;
      if (reset) {
        const { error: updErr } = await db.auth.admin.updateUserById(userId, { password });
        if (updErr) {
          logger.error({ err: updErr.message }, 'default-admin: password reset failed');
          return;
        }
        logger.warn({ email, userId }, 'default-admin: password reset (DEFAULT_ADMIN_RESET=true)');
      }
    }

    // Always arm must_change_password — the seeded password is meant to be
    // single-use. Reset paths re-arm it too.
    const now = new Date().toISOString();
    const { error: profileErr } = await db.from('users').upsert(
      {
        id: userId,
        email,
        full_name: name,
        role,
        must_change_password: true,
        temporary_password_sent_at: now,
        failed_login_attempts: 0,
        locked_until: null,
        is_active: true,
      },
      { onConflict: 'id' },
    );
    if (profileErr) {
      logger.error({ err: profileErr.message }, 'default-admin: public.users upsert failed');
      return;
    }

    // NEVER log the password. Operators read it from the env they themselves
    // set; logging it would leak it into logfiles + log aggregators.
    logger.warn(
      { email, role },
      `default-admin ready — sign in once at ${env.frontendUrl}/login and rotate the password immediately`,
    );
  } catch (err) {
    // Never let bootstrap failures crash the server — the API still works,
    // the admin just isn't auto-provisioned. Run `npm run bootstrap:admin`
    // manually to retry.
    logger.error({ err }, 'default-admin: unexpected error during bootstrap');
  }
}
