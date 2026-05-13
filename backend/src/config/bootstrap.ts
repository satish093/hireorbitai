import { supabaseAdmin } from './supabase';
import { env } from './env';
import { logger } from './logger';

/**
 * Ensures a default SUPER_ADMIN account exists. Runs once on server boot
 * (see server.ts). Idempotent:
 *
 *   - If the auth user already exists, we leave it alone unless RESET=true
 *     (which forces the password back to the default + arms must_change).
 *   - If only the auth.users row exists but public.users does not, we
 *     repair the link.
 *   - If both already exist with the right role, we no-op.
 *
 * The admin is created with `must_change_password = true`, so the very
 * first sign-in is forced through `/change-password` and the well-known
 * default password becomes unusable as soon as the human takes the bait.
 *
 * Skip the entire flow by setting DISABLE_DEFAULT_ADMIN=true in the env.
 */
export async function ensureDefaultAdmin(): Promise<void> {
  if (process.env.DISABLE_DEFAULT_ADMIN === 'true') {
    logger.info('default-admin bootstrap skipped (DISABLE_DEFAULT_ADMIN=true)');
    return;
  }

  const email = (process.env.DEFAULT_ADMIN_EMAIL ?? 'satish.flex07@gmail.com').toLowerCase();
  const password = process.env.DEFAULT_ADMIN_PASSWORD ?? 'Admin@123';
  const name = process.env.DEFAULT_ADMIN_NAME ?? 'Satish';
  const role = process.env.DEFAULT_ADMIN_ROLE ?? 'SUPER_ADMIN';
  const reset = process.env.DEFAULT_ADMIN_RESET === 'true';

  try {
    // 1. Look for the auth user. listUsers paginates at 50/page — we ask for
    //    up to 200, which is plenty for the bootstrap horizon (if you've grown
    //    beyond that, the admin already exists and we'd hit an earlier match).
    const { data: list, error: lookupErr } = await supabaseAdmin.auth.admin.listUsers({
      page: 1, perPage: 200,
    });
    if (lookupErr) {
      logger.warn({ err: lookupErr.message }, 'default-admin: listUsers failed; skipping bootstrap');
      return;
    }
    const existing = list.users.find((u) => (u.email ?? '').toLowerCase() === email);

    // 2. Check the matching public.users row.
    let profileRoleOk = false;
    if (existing) {
      const { data: profile } = await supabaseAdmin
        .from('users')
        .select('id, role, must_change_password')
        .eq('id', existing.id)
        .maybeSingle();
      profileRoleOk = profile?.role === role;
      if (profile && profileRoleOk && !reset) {
        logger.info({ email, userId: existing.id, role }, 'default-admin already provisioned — no action');
        return;
      }
    }

    let userId: string;
    if (!existing) {
      const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
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
      logger.info({ email, userId }, 'default-admin: created auth.users row');
    } else {
      userId = existing.id;
      // Reset path: force the password back to the default + re-arm
      // must_change_password. Useful for ops recovery; gated by the
      // explicit DEFAULT_ADMIN_RESET env switch so we don't surprise
      // anyone on a routine reboot.
      if (reset) {
        const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(userId, {
          password,
          email_confirm: true,
        });
        if (updErr) {
          logger.error({ err: updErr.message }, 'default-admin: password reset failed');
          return;
        }
        logger.warn({ email, userId }, 'default-admin: password reset to default (DEFAULT_ADMIN_RESET=true)');
      }
    }

    // 3. Upsert public.users with must_change_password=true so the first
    //    sign-in is forced through /change-password and the public default
    //    is rotated before the account is usable.
    const now = new Date().toISOString();
    const { error: profileErr } = await supabaseAdmin
      .from('users')
      .upsert(
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

    logger.warn(
      { email, role, defaultPassword: password },
      `default-admin ready — sign in once at ${env.frontendUrl}/login and rotate the password immediately`,
    );
  } catch (err) {
    // Never let bootstrap failures crash the server — the API still works,
    // the admin just isn't auto-provisioned. Run `npm run bootstrap:admin`
    // manually to retry.
    logger.error({ err }, 'default-admin: unexpected error during bootstrap');
  }
}
