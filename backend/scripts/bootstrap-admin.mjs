// Bootstrap the first SUPER_ADMIN account.
//
// Idempotent: if the auth user already exists, we just (re)set the password
// + role and re-arm must_change_password = true so the next sign-in forces
// a rotation.
//
// Run with Node 22's built-in env loader:
//   node --env-file=.env scripts/bootstrap-admin.mjs
//
// Required env vars:  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Optional overrides: BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_PASSWORD,
//                     BOOTSTRAP_ADMIN_NAME, BOOTSTRAP_ADMIN_ROLE.

import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Need SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const ADMIN_EMAIL    = (process.env.BOOTSTRAP_ADMIN_EMAIL    ?? 'satish.flex07@gmail.com').toLowerCase();
const ADMIN_PASSWORD =  process.env.BOOTSTRAP_ADMIN_PASSWORD ?? 'Admin@123';
const ADMIN_NAME     =  process.env.BOOTSTRAP_ADMIN_NAME     ?? 'Satish';
const ADMIN_ROLE     =  process.env.BOOTSTRAP_ADMIN_ROLE     ?? 'SUPER_ADMIN';

const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

console.log(`→ Bootstrapping ${ADMIN_ROLE} account for ${ADMIN_EMAIL}`);

// 1. Find or create the auth.users row.
let userId;
const { data: existing, error: lookupErr } = await supabase.auth.admin.listUsers({
  page: 1, perPage: 200,
});
if (lookupErr) { console.error('listUsers failed:', lookupErr.message); process.exit(1); }

const found = existing.users.find((u) => (u.email ?? '').toLowerCase() === ADMIN_EMAIL);
if (found) {
  userId = found.id;
  console.log(`  ✓ auth user already exists (${userId}) — updating password`);
  const { error: updErr } = await supabase.auth.admin.updateUserById(userId, {
    password: ADMIN_PASSWORD,
    email_confirm: true,
  });
  if (updErr) { console.error('updateUserById failed:', updErr.message); process.exit(1); }
} else {
  const { data: created, error: createErr } = await supabase.auth.admin.createUser({
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: ADMIN_NAME, bootstrap: true },
  });
  if (createErr || !created?.user) {
    console.error('createUser failed:', createErr?.message); process.exit(1);
  }
  userId = created.user.id;
  console.log(`  ✓ created auth user (${userId})`);
}

// 2. Upsert the matching public.users row + arm must_change_password.
const { error: profileErr } = await supabase
  .from('users')
  .upsert({
    id: userId,
    email: ADMIN_EMAIL,
    full_name: ADMIN_NAME,
    role: ADMIN_ROLE,
    must_change_password: true,
    temporary_password_sent_at: new Date().toISOString(),
    failed_login_attempts: 0,
    locked_until: null,
    is_active: true,
  }, { onConflict: 'id' });
if (profileErr) {
  console.error('users upsert failed:', profileErr.message);
  process.exit(1);
}

console.log('\n✓ Bootstrap complete.');
console.log(`   Email:    ${ADMIN_EMAIL}`);
console.log(`   Password: ${ADMIN_PASSWORD}     ← change immediately on first sign-in`);
console.log(`   Role:     ${ADMIN_ROLE}`);
console.log('\nThe account is flagged must_change_password=true; the app will route');
console.log('the user to /change-password on first sign-in and block all other routes');
console.log('until they pick a new password.\n');
