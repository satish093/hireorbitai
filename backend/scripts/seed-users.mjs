// One-shot seed script. Idempotent: re-run safely.
// Creates 2 managers, 2 recruiters (assigned to managers), 5 consultants
// (assigned to recruiters), each with onboarding profile rows so they
// bypass the consultant/recruiter onboarding gate.
//
// Run with Node 22's built-in env-file loader:
//   node --env-file=.env scripts/seed-users.mjs

import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Need SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY');

const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const PASSWORD = 'Passw0rd!2026';

const managers = [
  { email: 'priya.anand@talentbridge.test',  full_name: 'Priya Anand' },
  { email: 'david.chen@talentbridge.test',   full_name: 'David Chen' },
];

const recruiters = [
  {
    email: 'marcus.bell@talentbridge.test', full_name: 'Marcus Bell',
    manager_email: 'priya.anand@talentbridge.test',
    team: 'Pod Alpha', target_submissions_per_week: 12, notes: 'Pacific time zone.',
  },
  {
    email: 'sara.okonkwo@talentbridge.test', full_name: 'Sara Okonkwo',
    manager_email: 'david.chen@talentbridge.test',
    team: 'Pod Beta',  target_submissions_per_week: 10, notes: 'EST. Strong on data roles.',
  },
];

const consultants = [
  {
    email: 'aniket.rao@talentbridge.test',  full_name: 'Aniket Rao',
    recruiter_email: 'marcus.bell@talentbridge.test',
    visa_status: 'H1B', current_location: 'New York, NY',
    preferred_locations: ['New York, NY', 'Jersey City, NJ', 'Remote'],
    primary_skill: 'Senior Data Engineer', total_experience_years: 6,
    relocation: false, remote_only: false, expected_rate: 95,
    linkedin_url: 'https://www.linkedin.com/in/aniket-rao-example',
    notes: 'Java, Spark, Airflow. Available in 2 weeks.',
  },
  {
    email: 'yuki.tanaka@talentbridge.test',  full_name: 'Yuki Tanaka',
    recruiter_email: 'marcus.bell@talentbridge.test',
    visa_status: 'GC', current_location: 'San Francisco, CA',
    preferred_locations: ['San Francisco, CA', 'Remote'],
    primary_skill: 'Frontend Engineer', total_experience_years: 4,
    relocation: false, remote_only: true, expected_rate: 85,
    linkedin_url: 'https://www.linkedin.com/in/yuki-tanaka-example',
    notes: 'React, TypeScript, design-system experience.',
  },
  {
    email: 'rohan.mehta@talentbridge.test',  full_name: 'Rohan Mehta',
    recruiter_email: 'marcus.bell@talentbridge.test',
    visa_status: 'USC', current_location: 'Austin, TX',
    preferred_locations: ['Austin, TX', 'Dallas, TX', 'Remote'],
    primary_skill: 'Full-Stack Engineer', total_experience_years: 5,
    relocation: true, remote_only: false, expected_rate: 90,
    linkedin_url: 'https://www.linkedin.com/in/rohan-mehta-example',
    notes: 'Node, React, Postgres. US Citizen.',
  },
  {
    email: 'fatima.hassan@talentbridge.test', full_name: 'Fatima Hassan',
    recruiter_email: 'sara.okonkwo@talentbridge.test',
    visa_status: 'OPT', current_location: 'Remote',
    preferred_locations: ['Remote'],
    primary_skill: 'DevOps Engineer', total_experience_years: 7,
    relocation: false, remote_only: true, expected_rate: 110,
    linkedin_url: 'https://www.linkedin.com/in/fatima-hassan-example',
    notes: 'K8s, Terraform, AWS. Looking for remote-only.',
  },
  {
    email: 'linh.pham@talentbridge.test',    full_name: 'Linh Pham',
    recruiter_email: 'sara.okonkwo@talentbridge.test',
    visa_status: 'USC', current_location: 'Boston, MA',
    preferred_locations: ['Boston, MA', 'Cambridge, MA', 'Remote'],
    primary_skill: 'Backend Engineer', total_experience_years: 5,
    relocation: false, remote_only: false, expected_rate: 95,
    linkedin_url: 'https://www.linkedin.com/in/linh-pham-example',
    notes: 'Go, Python, GraphQL. US Citizen.',
  },
];

const emailToId = new Map();

async function getOrCreateAuthUser(email, full_name) {
  // 1. Look up by email first to keep this idempotent.
  const { data: existing } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const found = existing?.users?.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (found) {
    console.log(`  exists  ${email} -> ${found.id}`);
    return found.id;
  }
  const { data, error } = await supabase.auth.admin.createUser({
    email, password: PASSWORD, email_confirm: true, user_metadata: { full_name },
  });
  if (error) throw new Error(`create user ${email}: ${error.message}`);
  console.log(`  created ${email} -> ${data.user.id}`);
  return data.user.id;
}

async function upsertUserRow(id, email, full_name, role) {
  const { error } = await supabase.from('users').upsert(
    { id, email, full_name, role },
    { onConflict: 'id' }
  );
  if (error) throw new Error(`upsert users ${email}: ${error.message}`);
}

async function main() {
  console.log('--- 1. Auth users ---');
  for (const m of managers)    emailToId.set(m.email,    await getOrCreateAuthUser(m.email, m.full_name));
  for (const r of recruiters)  emailToId.set(r.email,    await getOrCreateAuthUser(r.email, r.full_name));
  for (const c of consultants) emailToId.set(c.email,    await getOrCreateAuthUser(c.email, c.full_name));

  console.log('\n--- 2. public.users rows ---');
  for (const m of managers)    await upsertUserRow(emailToId.get(m.email),  m.email, m.full_name, 'MANAGER');
  for (const r of recruiters)  await upsertUserRow(emailToId.get(r.email),  r.email, r.full_name, 'RECRUITER');
  for (const c of consultants) await upsertUserRow(emailToId.get(c.email),  c.email, c.full_name, 'CONSULTANT');
  console.log('  ok');

  console.log('\n--- 3. recruiters table ---');
  for (const r of recruiters) {
    const user_id    = emailToId.get(r.email);
    const manager_id = emailToId.get(r.manager_email);
    const { error } = await supabase.from('recruiters').upsert(
      {
        user_id, manager_id,
        team: r.team,
        target_submissions_per_week: r.target_submissions_per_week,
        notes: r.notes,
      },
      { onConflict: 'user_id' }
    );
    if (error) throw new Error(`upsert recruiters ${r.email}: ${error.message}`);
    console.log(`  ok      ${r.email}`);
  }

  console.log('\n--- 4. Resolve recruiter ids ---');
  const recruiterRowByEmail = new Map();
  for (const r of recruiters) {
    const user_id = emailToId.get(r.email);
    const { data, error } = await supabase.from('recruiters').select('id').eq('user_id', user_id).single();
    if (error) throw new Error(`find recruiter for ${r.email}: ${error.message}`);
    recruiterRowByEmail.set(r.email, data.id);
    console.log(`  ${r.email} -> recruiter ${data.id}`);
  }

  console.log('\n--- 5. consultants table ---');
  for (const c of consultants) {
    const user_id      = emailToId.get(c.email);
    const recruiter_id = recruiterRowByEmail.get(c.recruiter_email);
    const { error } = await supabase.from('consultants').upsert(
      {
        user_id, recruiter_id,
        visa_status: c.visa_status,
        current_location: c.current_location,
        preferred_locations: c.preferred_locations,
        primary_skill: c.primary_skill,
        total_experience_years: c.total_experience_years,
        relocation: c.relocation,
        remote_only: c.remote_only,
        expected_rate: c.expected_rate,
        linkedin_url: c.linkedin_url,
        notes: c.notes,
      },
      { onConflict: 'user_id' }
    );
    if (error) throw new Error(`upsert consultants ${c.email}: ${error.message}`);
    console.log(`  ok      ${c.email} -> recruiter ${c.recruiter_email}`);
  }

  console.log('\n--- summary ---');
  console.log(`  2 managers   : ${managers.map((m) => m.email).join(', ')}`);
  console.log(`  2 recruiters : ${recruiters.map((r) => r.email).join(', ')}`);
  console.log(`  5 consultants: ${consultants.map((c) => c.email).join(', ')}`);
  console.log(`  password (all): ${PASSWORD}`);
}

main().catch((e) => { console.error('SEED FAILED:', e.message); process.exit(1); });
