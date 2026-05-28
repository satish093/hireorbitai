// One-shot seed script. Idempotent: re-run safely.
//
// Creates 2 managers, 2 recruiters (assigned to managers), 5 consultants
// (assigned to recruiters), each with their associated profile rows so they
// bypass the consultant/recruiter onboarding gate.
//
// Run with Node 22's built-in env-file loader:
//   node --env-file=.env scripts/seed-users.mjs

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

// Phase 14 group model: every MANAGER / RECRUITER / CONSULTANT must belong to
// a group, and consultant.user.group_id must match their recruiter.user.group_id
// (the consultant↔recruiter same-group invariant). Pod Alpha → Xeronix group,
// Pod Beta → Okta Solutions group (both pre-seeded by database/init.sql).
const GROUP_SLUG = { alpha: 'xeronix', beta: 'okta-solutions' };

const managers = [
  { email: 'priya.anand@hireorbitai.test', full_name: 'Priya Anand', group: 'alpha' },
  { email: 'david.chen@hireorbitai.test', full_name: 'David Chen', group: 'beta' },
];

const recruiters = [
  {
    email: 'marcus.bell@hireorbitai.test',
    full_name: 'Marcus Bell',
    manager_email: 'priya.anand@hireorbitai.test',
    team: 'Pod Alpha',
    group: 'alpha',
    target_submissions_per_week: 12,
    notes: 'Pacific time zone.',
  },
  {
    email: 'sara.okonkwo@hireorbitai.test',
    full_name: 'Sara Okonkwo',
    manager_email: 'david.chen@hireorbitai.test',
    team: 'Pod Beta',
    group: 'beta',
    target_submissions_per_week: 10,
    notes: 'EST. Strong on data roles.',
  },
];

// Each consultant's `group` MUST match the group of their recruiter (Marcus →
// alpha, Sara → beta) — enforced by the Phase 14 consultant↔recruiter same-
// group invariant.
const consultants = [
  {
    email: 'aniket.rao@hireorbitai.test',
    full_name: 'Aniket Rao',
    recruiter_email: 'marcus.bell@hireorbitai.test',
    group: 'alpha',
    visa_status: 'H1B',
    current_location: 'New York, NY',
    preferred_locations: ['New York, NY', 'Jersey City, NJ', 'Remote'],
    primary_skill: 'Senior Data Engineer',
    total_experience_years: 6,
    relocation: false,
    remote_only: false,
    expected_rate: 95,
    linkedin_url: 'https://www.linkedin.com/in/aniket-rao-example',
    notes: 'Java, Spark, Airflow. Available in 2 weeks.',
  },
  {
    email: 'yuki.tanaka@hireorbitai.test',
    full_name: 'Yuki Tanaka',
    recruiter_email: 'marcus.bell@hireorbitai.test',
    group: 'alpha',
    visa_status: 'GC',
    current_location: 'San Francisco, CA',
    preferred_locations: ['San Francisco, CA', 'Remote'],
    primary_skill: 'Frontend Engineer',
    total_experience_years: 4,
    relocation: false,
    remote_only: true,
    expected_rate: 85,
    linkedin_url: 'https://www.linkedin.com/in/yuki-tanaka-example',
    notes: 'React, TypeScript, design-system experience.',
  },
  {
    email: 'rohan.mehta@hireorbitai.test',
    full_name: 'Rohan Mehta',
    recruiter_email: 'marcus.bell@hireorbitai.test',
    group: 'alpha',
    visa_status: 'USC',
    current_location: 'Austin, TX',
    preferred_locations: ['Austin, TX', 'Dallas, TX', 'Remote'],
    primary_skill: 'Full-Stack Engineer',
    total_experience_years: 5,
    relocation: true,
    remote_only: false,
    expected_rate: 90,
    linkedin_url: 'https://www.linkedin.com/in/rohan-mehta-example',
    notes: 'Node, React, Postgres. US Citizen.',
  },
  {
    email: 'fatima.hassan@hireorbitai.test',
    full_name: 'Fatima Hassan',
    recruiter_email: 'sara.okonkwo@hireorbitai.test',
    group: 'beta',
    visa_status: 'OPT',
    current_location: 'Remote',
    preferred_locations: ['Remote'],
    primary_skill: 'DevOps Engineer',
    total_experience_years: 7,
    relocation: false,
    remote_only: true,
    expected_rate: 110,
    linkedin_url: 'https://www.linkedin.com/in/fatima-hassan-example',
    notes: 'K8s, Terraform, AWS. Looking for remote-only.',
  },
  {
    email: 'linh.pham@hireorbitai.test',
    full_name: 'Linh Pham',
    recruiter_email: 'sara.okonkwo@hireorbitai.test',
    group: 'beta',
    visa_status: 'USC',
    current_location: 'Boston, MA',
    preferred_locations: ['Boston, MA', 'Cambridge, MA', 'Remote'],
    primary_skill: 'Backend Engineer',
    total_experience_years: 5,
    relocation: false,
    remote_only: false,
    expected_rate: 95,
    linkedin_url: 'https://www.linkedin.com/in/linh-pham-example',
    notes: 'Go, Python, GraphQL. US Citizen.',
  },
];

const emailToId = new Map();

async function upsertUser(email, full_name, role) {
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
    [id, email.toLowerCase(), PASSWORD_HASH, full_name, role],
  );
  const uid = r.rows[0].id;
  emailToId.set(email, uid);
  console.log(`  ok ${role.padEnd(10)} ${email} -> ${uid}`);
}

try {
  console.log('--- 1. public.users rows ---');
  for (const m of managers) await upsertUser(m.email, m.full_name, 'MANAGER');
  for (const r of recruiters) await upsertUser(r.email, r.full_name, 'RECRUITER');
  for (const c of consultants) await upsertUser(c.email, c.full_name, 'CONSULTANT');

  console.log('\n--- 2. recruiters table ---');
  for (const r of recruiters) {
    const user_id = emailToId.get(r.email);
    const manager_id = emailToId.get(r.manager_email);
    await pool.query(
      `INSERT INTO public.recruiters (user_id, manager_id, team, target_submissions_per_week, notes)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id) DO UPDATE SET
         manager_id = EXCLUDED.manager_id,
         team = EXCLUDED.team,
         target_submissions_per_week = EXCLUDED.target_submissions_per_week,
         notes = EXCLUDED.notes`,
      [user_id, manager_id, r.team, r.target_submissions_per_week, r.notes],
    );
    console.log(`  ok      ${r.email}`);
  }

  console.log('\n--- 3. Resolve recruiter ids ---');
  const recruiterRowByEmail = new Map();
  for (const r of recruiters) {
    const user_id = emailToId.get(r.email);
    const found = await pool.query(`SELECT id FROM public.recruiters WHERE user_id = $1`, [
      user_id,
    ]);
    recruiterRowByEmail.set(r.email, found.rows[0].id);
    console.log(`  ${r.email} -> recruiter ${found.rows[0].id}`);
  }

  console.log('\n--- 4. consultants table ---');
  for (const c of consultants) {
    const user_id = emailToId.get(c.email);
    const recruiter_id = recruiterRowByEmail.get(c.recruiter_email);
    await pool.query(
      `INSERT INTO public.consultants (
         user_id, recruiter_id, visa_status, current_location,
         preferred_locations, primary_skill, total_experience_years,
         relocation, remote_only, expected_rate, linkedin_url, notes
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (user_id) DO UPDATE SET
         recruiter_id = EXCLUDED.recruiter_id,
         visa_status = EXCLUDED.visa_status,
         current_location = EXCLUDED.current_location,
         preferred_locations = EXCLUDED.preferred_locations,
         primary_skill = EXCLUDED.primary_skill,
         total_experience_years = EXCLUDED.total_experience_years,
         relocation = EXCLUDED.relocation,
         remote_only = EXCLUDED.remote_only,
         expected_rate = EXCLUDED.expected_rate,
         linkedin_url = EXCLUDED.linkedin_url,
         notes = EXCLUDED.notes`,
      [
        user_id,
        recruiter_id,
        c.visa_status,
        c.current_location,
        c.preferred_locations,
        c.primary_skill,
        c.total_experience_years,
        c.relocation,
        c.remote_only,
        c.expected_rate,
        c.linkedin_url,
        c.notes,
      ],
    );
    console.log(`  ok      ${c.email} -> recruiter ${c.recruiter_email}`);
  }

  console.log('\n--- 5. group_id (Phase 14: every MGR/REC/CONS belongs to a pod) ---');
  // Ensure the target groups exist (no-op if init.sql or seed-leadership.mjs
  // already created them). Then resolve their ids.
  await pool.query(
    `INSERT INTO public.user_groups (name, slug, description) VALUES
       ('Xeronix',        'xeronix',        'Pod Alpha bench'),
       ('Okta Solutions', 'okta-solutions', 'Pod Beta bench')
     ON CONFLICT (slug) DO NOTHING`,
  );
  const groupIdBySlug = {};
  for (const slug of Object.values(GROUP_SLUG)) {
    const r = await pool.query(`SELECT id FROM public.user_groups WHERE slug = $1`, [slug]);
    if (!r.rows[0]) throw new Error(`Seed group missing: ${slug}`);
    groupIdBySlug[slug] = r.rows[0].id;
  }
  // Assign group_id from each user's `group` field. Consultants inherit their
  // recruiter's group by construction (see comment on `consultants` above) —
  // preserves the consultant↔recruiter same-group invariant.
  for (const u of [...managers, ...recruiters, ...consultants]) {
    const slug = GROUP_SLUG[u.group];
    if (!slug) throw new Error(`User ${u.email} has no group assignment`);
    await pool.query(`UPDATE public.users SET group_id = $1 WHERE id = $2`, [
      groupIdBySlug[slug],
      emailToId.get(u.email),
    ]);
  }
  console.log(
    `  ${managers.length + recruiters.length + consultants.length} users -> {alpha:xeronix, beta:okta-solutions}`,
  );

  console.log('\n--- summary ---');
  console.log(`  2 managers   : ${managers.map((m) => m.email).join(', ')}`);
  console.log(`  2 recruiters : ${recruiters.map((r) => r.email).join(', ')}`);
  console.log(`  5 consultants: ${consultants.map((c) => c.email).join(', ')}`);
  console.log(`  groups       : Pod Alpha (Xeronix) — Priya + Marcus + 3 consultants`);
  console.log(`                 Pod Beta  (Okta Solutions) — David + Sara + 2 consultants`);
  console.log(`  password (all): ${PASSWORD}`);
} catch (e) {
  console.error('SEED FAILED:', e.message);
  process.exit(1);
} finally {
  await pool.end();
}
