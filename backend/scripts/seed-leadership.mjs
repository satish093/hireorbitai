// Seed the leadership / org-chart: CEO Satish, CTO Rishi, Director Deepak,
// Managers Neeraj + Nikhil, Recruiters Sai + Bharth + Ashok.
// Wires public.users.reports_to + public.recruiters.manager_id so the chain
// is queryable. Idempotent — re-run anytime.
//
// Run with Node 22's built-in env-file loader:
//   node --env-file=.env scripts/seed-leadership.mjs

import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Need SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY');

const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const PASSWORD = 'Passw0rd!2026';

// Order matters — each level references the one above it via reports_to.
const ceo       = { email: 'satish@talentbridge.test',  full_name: 'Satish Kurelly',  role: 'CEO',       reports_to_email: null };
const cto       = { email: 'rishi@talentbridge.test',   full_name: 'Rishi',           role: 'CTO',       reports_to_email: 'satish@talentbridge.test' };
const director  = { email: 'deepak@talentbridge.test',  full_name: 'Deepak',          role: 'DIRECTOR',  reports_to_email: 'rishi@talentbridge.test' };

const managers = [
  { email: 'neeraj@talentbridge.test', full_name: 'Neeraj', role: 'MANAGER', reports_to_email: 'deepak@talentbridge.test' },
  { email: 'nikhil@talentbridge.test', full_name: 'Nikhil', role: 'MANAGER', reports_to_email: 'deepak@talentbridge.test' },
];

const recruiters = [
  {
    email: 'sai@talentbridge.test',     full_name: 'Sai',     role: 'RECRUITER',
    reports_to_email: 'neeraj@talentbridge.test',
    team: 'Pod Gamma', target_submissions_per_week: 12,
  },
  {
    email: 'bharth@talentbridge.test',  full_name: 'Bharth',  role: 'RECRUITER',
    reports_to_email: 'neeraj@talentbridge.test',
    team: 'Pod Gamma', target_submissions_per_week: 10,
  },
  {
    email: 'ashok@talentbridge.test',   full_name: 'Ashok',   role: 'RECRUITER',
    reports_to_email: 'nikhil@talentbridge.test',
    team: 'Pod Delta', target_submissions_per_week: 10,
  },
];

const all = [ceo, cto, director, ...managers, ...recruiters];
const idByEmail = new Map();

async function getOrCreate(u) {
  const { data: page } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const found = page?.users?.find((x) => x.email?.toLowerCase() === u.email.toLowerCase());
  if (found) { console.log(`  exists  ${u.email.padEnd(38)} -> ${found.id}`); return found.id; }
  const { data, error } = await supabase.auth.admin.createUser({
    email: u.email, password: PASSWORD, email_confirm: true,
    user_metadata: { full_name: u.full_name },
  });
  if (error) throw new Error(`create ${u.email}: ${error.message}`);
  console.log(`  created ${u.email.padEnd(38)} -> ${data.user.id}`);
  return data.user.id;
}

async function main() {
  console.log('--- 1. Auth users ---');
  for (const u of all) idByEmail.set(u.email, await getOrCreate(u));

  console.log('\n--- 2. public.users (role + reports_to) ---');
  for (const u of all) {
    const reports_to = u.reports_to_email ? idByEmail.get(u.reports_to_email) : null;
    const { error } = await supabase.from('users').upsert(
      { id: idByEmail.get(u.email), email: u.email, full_name: u.full_name, role: u.role, reports_to },
      { onConflict: 'id' }
    );
    if (error) throw new Error(`upsert ${u.email}: ${error.message}`);
    const tag = reports_to ? `  →  ${u.reports_to_email}` : '';
    console.log(`  ${u.role.padEnd(10)} ${u.full_name.padEnd(8)} ${u.email.padEnd(36)}${tag}`);
  }

  console.log('\n--- 3. recruiters rows (manager_id = direct supervisor) ---');
  for (const r of recruiters) {
    const user_id    = idByEmail.get(r.email);
    const manager_id = idByEmail.get(r.reports_to_email);
    const { error } = await supabase.from('recruiters').upsert(
      {
        user_id, manager_id,
        team: r.team,
        target_submissions_per_week: r.target_submissions_per_week,
      },
      { onConflict: 'user_id' }
    );
    if (error) throw new Error(`upsert recruiters ${r.email}: ${error.message}`);
    console.log(`  ${r.full_name.padEnd(8)} ${r.team.padEnd(12)} manager=${r.reports_to_email}`);
  }

  console.log('\n--- Org chart ---');
  console.log(`  CEO       Satish Kurelly`);
  console.log(`   └─ CTO       Rishi`);
  console.log(`        └─ DIRECTOR  Deepak`);
  console.log(`             ├─ MANAGER   Neeraj`);
  console.log(`             │   ├─ RECRUITER Sai     (Pod Gamma)`);
  console.log(`             │   └─ RECRUITER Bharth  (Pod Gamma)`);
  console.log(`             └─ MANAGER   Nikhil`);
  console.log(`                 └─ RECRUITER Ashok   (Pod Delta)`);
  console.log(`\n  Password for all: ${PASSWORD}`);
}

main().catch((e) => { console.error('\nSEED FAILED:', e.message); process.exit(1); });
