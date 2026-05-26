// Seed the leadership / org-chart: CEO Satish, CTO Rishi, Director Deepak,
// Managers Neeraj + Nikhil, Recruiters Sai + Bharth + Ashok.
// Wires public.users.reports_to + public.recruiters.manager_id so the chain
// is queryable. Idempotent — re-run anytime.
//
// Run with Node 22's built-in env-file loader:
//   node --env-file=.env scripts/seed-leadership.mjs

import { randomUUID } from 'node:crypto';
import pg from 'pg';
import bcrypt from 'bcryptjs';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('Need DATABASE_URL');

const sslMode = process.env.DATABASE_SSL ?? 'disable';
const ssl =
  sslMode === 'disable'
    ? false
    : sslMode === 'no-verify'
      ? { rejectUnauthorized: false }
      : { rejectUnauthorized: true };

const pool = new pg.Pool({ connectionString: url, ssl });

// Demo / sandbox seed — never run against a production database. Bail loudly
// if NODE_ENV=production unless the operator explicitly opts in via
// SEED_ALLOW_PROD=true.
if (process.env.NODE_ENV === 'production' && process.env.SEED_ALLOW_PROD !== 'true') {
  console.error(
    'Refusing to seed demo users against a production DB. Set SEED_ALLOW_PROD=true if you really want this.',
  );
  process.exit(1);
}

const PASSWORD = process.env.SEED_PASSWORD ?? 'Passw0rd!2026';
if (PASSWORD.length < 8) throw new Error('SEED_PASSWORD must be at least 8 characters.');
const PASSWORD_HASH = await bcrypt.hash(PASSWORD, 10);

// Order matters — each level references the one above it via reports_to.
const ceo = {
  email: 'satish@hireorbitai.test',
  full_name: 'Satish Kurelly',
  role: 'CEO',
  reports_to_email: null,
};
const cto = {
  email: 'rishi@hireorbitai.test',
  full_name: 'Rishi',
  role: 'CTO',
  reports_to_email: 'satish@hireorbitai.test',
};
const director = {
  email: 'deepak@hireorbitai.test',
  full_name: 'Deepak',
  role: 'DIRECTOR',
  reports_to_email: 'rishi@hireorbitai.test',
};

const managers = [
  {
    email: 'neeraj@hireorbitai.test',
    full_name: 'Neeraj',
    role: 'MANAGER',
    reports_to_email: 'deepak@hireorbitai.test',
  },
  {
    email: 'nikhil@hireorbitai.test',
    full_name: 'Nikhil',
    role: 'MANAGER',
    reports_to_email: 'deepak@hireorbitai.test',
  },
];

const recruiters = [
  {
    email: 'sai@hireorbitai.test',
    full_name: 'Sai',
    role: 'RECRUITER',
    reports_to_email: 'neeraj@hireorbitai.test',
    team: 'Pod Gamma',
    target_submissions_per_week: 12,
  },
  {
    email: 'bharth@hireorbitai.test',
    full_name: 'Bharth',
    role: 'RECRUITER',
    reports_to_email: 'neeraj@hireorbitai.test',
    team: 'Pod Gamma',
    target_submissions_per_week: 10,
  },
  {
    email: 'ashok@hireorbitai.test',
    full_name: 'Ashok',
    role: 'RECRUITER',
    reports_to_email: 'nikhil@hireorbitai.test',
    team: 'Pod Delta',
    target_submissions_per_week: 10,
  },
];

const all = [ceo, cto, director, ...managers, ...recruiters];
const idByEmail = new Map();

try {
  console.log('--- 1. public.users (with bcrypt password hash) ---');
  for (const u of all) {
    const id = randomUUID();
    const r = await pool.query(
      `INSERT INTO public.users (id, email, password_hash, full_name, role, is_active, must_change_password, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, true, false, now(), now())
       ON CONFLICT (email) DO UPDATE SET
         password_hash = EXCLUDED.password_hash,
         full_name = EXCLUDED.full_name,
         role = EXCLUDED.role,
         must_change_password = false,
         updated_at = now()
       RETURNING id`,
      [id, u.email.toLowerCase(), PASSWORD_HASH, u.full_name, u.role],
    );
    idByEmail.set(u.email, r.rows[0].id);
    console.log(`  ${u.role.padEnd(10)} ${u.email.padEnd(38)} -> ${r.rows[0].id}`);
  }

  console.log('\n--- 2. reports_to chain ---');
  for (const u of all) {
    const reports_to = u.reports_to_email ? idByEmail.get(u.reports_to_email) : null;
    await pool.query(`UPDATE public.users SET reports_to = $1 WHERE id = $2`, [
      reports_to,
      idByEmail.get(u.email),
    ]);
    const tag = reports_to ? `  →  ${u.reports_to_email}` : '';
    console.log(`  ${u.role.padEnd(10)} ${u.full_name.padEnd(8)} ${u.email.padEnd(36)}${tag}`);
  }

  console.log('\n--- 3. recruiters rows (manager_id = direct supervisor) ---');
  for (const r of recruiters) {
    const user_id = idByEmail.get(r.email);
    const manager_id = idByEmail.get(r.reports_to_email);
    await pool.query(
      `INSERT INTO public.recruiters (user_id, manager_id, team, target_submissions_per_week)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id) DO UPDATE SET
         manager_id = EXCLUDED.manager_id,
         team = EXCLUDED.team,
         target_submissions_per_week = EXCLUDED.target_submissions_per_week`,
      [user_id, manager_id, r.team, r.target_submissions_per_week],
    );
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
} catch (e) {
  console.error('\nSEED FAILED:', e.message);
  process.exit(1);
} finally {
  await pool.end();
}
