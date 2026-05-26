// Rich, cross-linked operational mock data for the DEVELOPMENT environment.
//
// Runs AFTER seed-leadership.mjs / seed-users.mjs (it resolves the seeded
// users/recruiters/consultants by email). Seeds clients, vendors, jobs,
// applications, interviews, messages, reminders, and recruiter daily activity
// — enough to make every core dashboard/page show realistic, related data.
//
// Idempotent: re-running deletes the previously-seeded mock rows (jobs by a
// `seed://` source_url marker, which cascades applications + interviews) and
// re-inserts. Never run against production.
//
//   node --env-file=.env scripts/seed-mock-data.mjs

import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('Need DATABASE_URL');

if (process.env.NODE_ENV === 'production' && process.env.SEED_ALLOW_PROD !== 'true') {
  console.error(
    'Refusing to seed mock data against a production DB. Set SEED_ALLOW_PROD=true to override.',
  );
  process.exit(1);
}

const sslMode = process.env.DATABASE_SSL ?? 'disable';
const ssl =
  sslMode === 'disable'
    ? false
    : sslMode === 'no-verify'
      ? { rejectUnauthorized: false }
      : { rejectUnauthorized: true };

const pool = new pg.Pool({ connectionString: url, ssl });

const SEED_MARKER = 'seed://mock/';

// Seeded user emails (must match seed-users.mjs).
const MANAGERS = ['priya.anand@hireorbitai.test', 'david.chen@hireorbitai.test'];
const RECRUITERS = ['marcus.bell@hireorbitai.test', 'sara.okonkwo@hireorbitai.test'];
const CONSULTANTS = [
  'aniket.rao@hireorbitai.test',
  'yuki.tanaka@hireorbitai.test',
  'rohan.mehta@hireorbitai.test',
  'fatima.hassan@hireorbitai.test',
  'linh.pham@hireorbitai.test',
];

const CLIENTS = [
  {
    company_name: 'TechCorp',
    industry: 'SaaS',
    location: 'New York, NY',
    contact_name: 'Dana Lee',
  },
  {
    company_name: 'DataInc',
    industry: 'Analytics',
    location: 'San Francisco, CA',
    contact_name: 'Omar Reyes',
  },
];
const VENDORS = [
  { company_name: 'RecruitHub', tier: 'Prime', contact_name: 'Jamie Fox' },
  { company_name: 'PlacementCo', tier: 'T1', contact_name: 'Pat Singh' },
];

async function resolveUserId(client, email) {
  const r = await client.query('SELECT id FROM public.users WHERE email = $1', [
    email.toLowerCase(),
  ]);
  if (!r.rows[0]) throw new Error(`Seed user missing: ${email}. Run seed-users.mjs first.`);
  return r.rows[0].id;
}
async function resolveRecruiterId(client, email) {
  const uid = await resolveUserId(client, email);
  const r = await client.query('SELECT id FROM public.recruiters WHERE user_id = $1', [uid]);
  if (!r.rows[0]) throw new Error(`Recruiter profile missing for ${email}.`);
  return r.rows[0].id;
}
async function resolveConsultantId(client, email) {
  const uid = await resolveUserId(client, email);
  const r = await client.query('SELECT id FROM public.consultants WHERE user_id = $1', [uid]);
  if (!r.rows[0]) throw new Error(`Consultant profile missing for ${email}.`);
  return r.rows[0].id;
}

const client = await pool.connect();
try {
  await client.query('BEGIN');

  // Resolve ids -------------------------------------------------------------
  const userId = {};
  for (const e of [...MANAGERS, ...RECRUITERS, ...CONSULTANTS])
    userId[e] = await resolveUserId(client, e);
  const recruiterId = {};
  for (const e of RECRUITERS) recruiterId[e] = await resolveRecruiterId(client, e);
  const consultantId = {};
  for (const e of CONSULTANTS) consultantId[e] = await resolveConsultantId(client, e);
  const adminId = userId[MANAGERS[0]];

  // Clean previous mock rows (jobs cascade to applications + interviews) ----
  await client.query(`DELETE FROM public.jobs WHERE source_url LIKE $1`, [`${SEED_MARKER}%`]);
  await client.query(`DELETE FROM public.clients WHERE company_name = ANY($1)`, [
    CLIENTS.map((c) => c.company_name),
  ]);
  await client.query(`DELETE FROM public.vendors WHERE company_name = ANY($1)`, [
    VENDORS.map((v) => v.company_name),
  ]);
  const seededUserIds = Object.values(userId);
  await client.query(
    `DELETE FROM public.messages WHERE sender_id = ANY($1) AND recipient_id = ANY($1)`,
    [seededUserIds],
  );
  await client.query(`DELETE FROM public.reminders WHERE owner_id = ANY($1)`, [seededUserIds]);
  await client.query(`DELETE FROM public.recruiter_daily_activity WHERE recruiter_id = ANY($1)`, [
    Object.values(recruiterId),
  ]);

  // Clients + vendors -------------------------------------------------------
  const clientId = {};
  for (const c of CLIENTS) {
    const r = await client.query(
      `INSERT INTO public.clients (company_name, industry, location, contact_name, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [c.company_name, c.industry, c.location, c.contact_name, adminId],
    );
    clientId[c.company_name] = r.rows[0].id;
  }
  const vendorId = {};
  for (const v of VENDORS) {
    const r = await client.query(
      `INSERT INTO public.vendors (company_name, tier, contact_name, created_by)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [v.company_name, v.tier, v.contact_name, adminId],
    );
    vendorId[v.company_name] = r.rows[0].id;
  }

  // Jobs --------------------------------------------------------------------
  const JOBS = [
    {
      slug: 'techcorp-senior-backend',
      title: 'Senior Backend Engineer',
      client: 'TechCorp',
      vendor: 'RecruitHub',
      location: 'New York, NY',
      remote: false,
      job_type: 'C2C',
      rate_min: 80,
      rate_max: 100,
      skills: ['Java', 'Spring Boot', 'PostgreSQL', 'AWS'],
    },
    {
      slug: 'datainc-data-engineer',
      title: 'Data Engineer',
      client: 'DataInc',
      vendor: 'RecruitHub',
      location: 'Remote',
      remote: true,
      job_type: 'W2',
      rate_min: 85,
      rate_max: 110,
      skills: ['Python', 'Spark', 'Airflow', 'SQL'],
    },
    {
      slug: 'techcorp-devops',
      title: 'DevOps Engineer',
      client: 'TechCorp',
      vendor: 'PlacementCo',
      location: 'Remote',
      remote: true,
      job_type: 'C2C',
      rate_min: 95,
      rate_max: 120,
      skills: ['Kubernetes', 'Terraform', 'AWS', 'CI/CD'],
    },
    {
      slug: 'datainc-frontend',
      title: 'Frontend Engineer',
      client: 'DataInc',
      vendor: 'PlacementCo',
      location: 'San Francisco, CA',
      remote: false,
      job_type: 'FTE',
      rate_min: 70,
      rate_max: 95,
      skills: ['React', 'TypeScript', 'CSS'],
    },
    {
      slug: 'techcorp-fullstack',
      title: 'Full-Stack Engineer',
      client: 'TechCorp',
      vendor: 'RecruitHub',
      location: 'Austin, TX',
      remote: false,
      job_type: 'C2C',
      rate_min: 80,
      rate_max: 105,
      skills: ['Node.js', 'React', 'PostgreSQL'],
    },
    {
      slug: 'datainc-backend',
      title: 'Backend Engineer (Go)',
      client: 'DataInc',
      vendor: 'PlacementCo',
      location: 'Boston, MA',
      remote: false,
      job_type: 'W2',
      rate_min: 85,
      rate_max: 110,
      skills: ['Go', 'GraphQL', 'Python'],
    },
  ];
  const jobId = {};
  for (const j of JOBS) {
    const r = await client.query(
      `INSERT INTO public.jobs (title, client_id, vendor_id, location, remote, job_type, rate_min, rate_max, description, required_skills, source_url, posted_at, is_active, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now() - interval '7 days', true, $12) RETURNING id`,
      [
        j.title,
        clientId[j.client],
        vendorId[j.vendor],
        j.location,
        j.remote,
        j.job_type,
        j.rate_min,
        j.rate_max,
        `${j.title} at ${j.client}. Skills: ${j.skills.join(', ')}.`,
        j.skills,
        `${SEED_MARKER}${j.slug}`,
        adminId,
      ],
    );
    jobId[j.slug] = r.rows[0].id;
  }

  // Applications (consultant ↔ job), varied status --------------------------
  const APPS = [
    {
      consultant: CONSULTANTS[0],
      job: 'datainc-data-engineer',
      recruiter: RECRUITERS[0],
      vendor: 'RecruitHub',
      status: 'INTERVIEW',
      ats: 88,
    },
    {
      consultant: CONSULTANTS[0],
      job: 'techcorp-senior-backend',
      recruiter: RECRUITERS[0],
      vendor: 'RecruitHub',
      status: 'SUBMITTED',
      ats: 81,
    },
    {
      consultant: CONSULTANTS[1],
      job: 'datainc-frontend',
      recruiter: RECRUITERS[0],
      vendor: 'PlacementCo',
      status: 'SCREENING',
      ats: 76,
    },
    {
      consultant: CONSULTANTS[2],
      job: 'techcorp-fullstack',
      recruiter: RECRUITERS[0],
      vendor: 'RecruitHub',
      status: 'OFFER',
      ats: 91,
    },
    {
      consultant: CONSULTANTS[3],
      job: 'techcorp-devops',
      recruiter: RECRUITERS[1],
      vendor: 'PlacementCo',
      status: 'INTERVIEW',
      ats: 89,
    },
    {
      consultant: CONSULTANTS[4],
      job: 'datainc-backend',
      recruiter: RECRUITERS[1],
      vendor: 'PlacementCo',
      status: 'REJECTED',
      ats: 64,
    },
  ];
  const appId = {};
  for (const a of APPS) {
    const r = await client.query(
      `INSERT INTO public.applications (consultant_id, job_id, vendor_id, recruiter_id, ats_score, status, submitted_at, notes)
       VALUES ($1,$2,$3,$4,$5,$6, now() - interval '4 days', $7)
       ON CONFLICT (consultant_id, job_id, vendor_id) DO NOTHING
       RETURNING id`,
      [
        consultantId[a.consultant],
        jobId[a.job],
        vendorId[a.vendor],
        recruiterId[a.recruiter],
        a.ats,
        a.status,
        'Seeded demo submission.',
      ],
    );
    if (r.rows[0]) appId[`${a.consultant}:${a.job}`] = r.rows[0].id;
  }

  // Interviews for the INTERVIEW-status applications ------------------------
  const INTERVIEWS = [
    {
      consultant: CONSULTANTS[0],
      job: 'datainc-data-engineer',
      type: 'TECHNICAL',
      status: 'SCHEDULED',
      inDays: 2,
      interviewer: 'Omar Reyes',
    },
    {
      consultant: CONSULTANTS[3],
      job: 'techcorp-devops',
      type: 'BEHAVIORAL',
      status: 'COMPLETED',
      inDays: -1,
      interviewer: 'Dana Lee',
    },
  ];
  for (const iv of INTERVIEWS) {
    const aId = appId[`${iv.consultant}:${iv.job}`];
    await client.query(
      `INSERT INTO public.interviews (application_id, consultant_id, type, scheduled_at, duration_minutes, interviewer, status, created_by)
       VALUES ($1,$2,$3, now() + ($4 || ' days')::interval, 60, $5, $6, $7)`,
      [
        aId ?? null,
        consultantId[iv.consultant],
        iv.type,
        String(iv.inDays),
        iv.interviewer,
        iv.status,
        adminId,
      ],
    );
  }

  // Messages (recruiter ↔ manager, recruiter ↔ consultant) ------------------
  const MESSAGES = [
    {
      from: RECRUITERS[0],
      to: MANAGERS[0],
      body: 'Pipeline looks strong this week — 3 submissions, 1 interview scheduled.',
    },
    {
      from: MANAGERS[0],
      to: RECRUITERS[0],
      body: 'Great. Push on the TechCorp full-stack offer — client wants to close fast.',
    },
    {
      from: RECRUITERS[0],
      to: CONSULTANTS[0],
      body: 'You have a technical interview with DataInc in 2 days. Prep doc incoming.',
    },
    {
      from: RECRUITERS[1],
      to: CONSULTANTS[3],
      body: 'DevOps interview went well — waiting on client feedback.',
    },
  ];
  for (const m of MESSAGES) {
    await client.query(
      `INSERT INTO public.messages (sender_id, recipient_id, body, created_at)
       VALUES ($1,$2,$3, now() - (random() * 3 || ' days')::interval)`,
      [userId[m.from], userId[m.to], m.body],
    );
  }

  // Reminders ---------------------------------------------------------------
  const REMINDERS = [
    {
      owner: RECRUITERS[0],
      title: 'Follow up with DataInc on data-engineer submission',
      related_type: 'application',
      dueInDays: 1,
      status: 'PENDING',
    },
    {
      owner: RECRUITERS[0],
      title: 'Confirm interview logistics for Aniket',
      related_type: 'interview',
      dueInDays: 1,
      status: 'PENDING',
    },
    {
      owner: RECRUITERS[1],
      title: 'Chase TechCorp DevOps feedback',
      related_type: 'application',
      dueInDays: 2,
      status: 'PENDING',
    },
    {
      owner: MANAGERS[0],
      title: 'Weekly pipeline review with Pod Alpha',
      related_type: null,
      dueInDays: 3,
      status: 'PENDING',
    },
  ];
  for (const rm of REMINDERS) {
    await client.query(
      `INSERT INTO public.reminders (owner_id, title, related_type, due_at, status)
       VALUES ($1,$2,$3, now() + ($4 || ' days')::interval, $5)`,
      [userId[rm.owner], rm.title, rm.related_type, String(rm.dueInDays), rm.status],
    );
  }

  // Recruiter daily activity — last 5 days per recruiter --------------------
  for (const e of RECRUITERS) {
    for (let d = 0; d < 5; d++) {
      const subs = 2 + ((d * 3 + e.length) % 4);
      await client.query(
        `INSERT INTO public.recruiter_daily_activity
           (recruiter_id, activity_date, submissions_count, interviews_scheduled, interviews_completed, vendor_calls, offers, placements)
         VALUES ($1, current_date - $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (recruiter_id, activity_date) DO UPDATE SET
           submissions_count = EXCLUDED.submissions_count,
           interviews_scheduled = EXCLUDED.interviews_scheduled,
           interviews_completed = EXCLUDED.interviews_completed,
           vendor_calls = EXCLUDED.vendor_calls,
           offers = EXCLUDED.offers,
           placements = EXCLUDED.placements`,
        [
          recruiterId[e],
          d,
          subs,
          Math.max(0, subs - 1),
          Math.max(0, subs - 2),
          3 + (d % 3),
          d === 1 ? 1 : 0,
          d === 3 ? 1 : 0,
        ],
      );
    }
  }

  await client.query('COMMIT');
  console.log('--- mock data seeded ---');
  console.log(`  clients: ${CLIENTS.length}  vendors: ${VENDORS.length}  jobs: ${JOBS.length}`);
  console.log(`  applications: ${APPS.length}  interviews: ${INTERVIEWS.length}`);
  console.log(`  messages: ${MESSAGES.length}  reminders: ${REMINDERS.length}`);
  console.log(`  recruiter daily activity: ${RECRUITERS.length} recruiters × 5 days`);
} catch (e) {
  await client.query('ROLLBACK');
  console.error('SEED FAILED:', e.message);
  process.exit(1);
} finally {
  client.release();
  await pool.end();
}
