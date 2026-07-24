// Bootstrap the first SUPER_ADMIN account.
//
// Idempotent: if the user already exists we just re-hash the password + arm
// must_change_password = true so the next sign-in forces a rotation.
//
// Run with Node 22's built-in env loader:
//   node --env-file=.env scripts/bootstrap-admin.mjs
//
// Required env vars:
//   DATABASE_URL
//   DEFAULT_ADMIN_EMAIL
//   DEFAULT_ADMIN_PASSWORD    (>= 12 characters; will be rotated on first login)
// Optional:
//   DEFAULT_ADMIN_NAME        (default: empty)
//   DEFAULT_ADMIN_ROLE        (default: SUPER_ADMIN)
//   DATABASE_SSL              (disable | require | no-verify; default: disable)

import { randomUUID } from 'node:crypto';
import pg from 'pg';
import bcrypt from 'bcryptjs';

function die(msg) {
  console.error(msg);
  process.exit(1);
}

const url = process.env.DATABASE_URL;
if (!url) die('DATABASE_URL is required (postgres://user:pass@host:5432/dbname).');

const ADMIN_EMAIL = (process.env.DEFAULT_ADMIN_EMAIL ?? '').trim().toLowerCase();
const ADMIN_PASSWORD = process.env.DEFAULT_ADMIN_PASSWORD ?? '';
const ADMIN_NAME = (process.env.DEFAULT_ADMIN_NAME ?? '').trim() || null;
const ADMIN_ROLE = (process.env.DEFAULT_ADMIN_ROLE ?? 'SUPER_ADMIN').trim();

if (!ADMIN_EMAIL) die('DEFAULT_ADMIN_EMAIL is required.');
if (!/^.+@.+\..+$/.test(ADMIN_EMAIL))
  die(`DEFAULT_ADMIN_EMAIL is not a valid email: ${ADMIN_EMAIL}`);
if (!ADMIN_PASSWORD) die('DEFAULT_ADMIN_PASSWORD is required.');
if (ADMIN_PASSWORD.length < 12) die('DEFAULT_ADMIN_PASSWORD must be at least 12 characters.');

const sslMode = process.env.DATABASE_SSL ?? 'disable';
const ssl =
  sslMode === 'disable'
    ? false
    : sslMode === 'no-verify'
      ? { rejectUnauthorized: false }
      : { rejectUnauthorized: true };

const pool = new pg.Pool({ connectionString: url, ssl });

console.log(`→ Bootstrapping ${ADMIN_ROLE} account for ${ADMIN_EMAIL}`);

try {
  const hash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  const id = randomUUID();
  const now = new Date().toISOString();

  // Upsert by email. session_version is bumped on update so any stale tokens
  // from a previous bootstrap are invalidated.
  const r = await pool.query(
    `INSERT INTO public.users (
        id, email, password_hash, full_name, role,
        must_change_password, temporary_password_sent_at,
        failed_login_attempts, locked_until, is_active,
        session_version, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, true, $6, 0, NULL, true, 0, now(), now())
      ON CONFLICT (email) DO UPDATE SET
        password_hash = EXCLUDED.password_hash,
        full_name = EXCLUDED.full_name,
        role = EXCLUDED.role,
        must_change_password = true,
        temporary_password_sent_at = EXCLUDED.temporary_password_sent_at,
        failed_login_attempts = 0,
        locked_until = NULL,
        is_active = true,
        session_version = public.users.session_version + 1,
        updated_at = now()
      RETURNING id`,
    [id, ADMIN_EMAIL, hash, ADMIN_NAME, ADMIN_ROLE, now],
  );

  const userId = r.rows[0]?.id ?? id;
  console.log(`  ✓ admin row ready (${userId})`);

  // Deliberately do NOT echo the password back. The operator already knows
  // what they typed into .env; printing it would leak it into shell history
  // / terminal scrollback / CI logs.
  console.log('\n✓ Bootstrap complete.');
  console.log(`   Email: ${ADMIN_EMAIL}`);
  console.log(`   Role:  ${ADMIN_ROLE}`);
  console.log('\nThe account is flagged must_change_password=true; the app will route');
  console.log('the user to /change-password on first sign-in and block all other routes');
  console.log('until they pick a new password.\n');
} catch (err) {
  console.error('bootstrap failed:', err.message);
  process.exit(1);
} finally {
  await pool.end();
}
