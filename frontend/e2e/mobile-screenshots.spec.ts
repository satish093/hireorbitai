/**
 * Mobile screenshot sweep — iPhone 12 viewport (390×844).
 * Saves screenshots to e2e-results/mobile-screenshots/.
 * Run with: npm --prefix frontend run test:e2e -- mobile-screenshots
 */
import { test } from '@playwright/test';
import { seedSession, mockApi, MANAGER } from './_helpers';
import * as fs from 'fs';
import * as path from 'path';

// playwright.config.ts sets outputDir: './e2e-results', cwd is the frontend package root
const OUT = path.resolve('e2e-results/mobile-screenshots');

const PAGES = [
  { name: 'dashboard', path: '/dashboard' },
  { name: 'tasks', path: '/tasks' },
  { name: 'jobs', path: '/jobs' },
  { name: 'calendar', path: '/calendar' },
  { name: 'interviews', path: '/interviews' },
  { name: 'applications', path: '/applications' },
  { name: 'messages', path: '/messages' },
  { name: 'reminders', path: '/reminders' },
  { name: 'reports', path: '/reports' },
  { name: 'training', path: '/training' },
  { name: 'resumes', path: '/resumes' },
  { name: 'consultants', path: '/consultants' },
];

const NOW = Date.now();
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

const MOCK_HANDLERS = {
  // ── Tasks ────────────────────────────────────────────────────────────────
  '/tasks': {
    json: [
      {
        id: 't-1',
        title: 'Review candidate profile for Senior Engineer role',
        status: 'IN_PROGRESS',
        priority: 'HIGH',
        due_at: iso(86400_000),
        assignee_id: 'u-manager',
        assignee: { id: 'u-manager', email: 'morgan@test.local', full_name: 'Morgan Manager' },
        created_at: iso(-172800_000),
        updated_at: iso(-3600_000),
        comment_count: 2,
        tags: ['hiring'],
      },
      {
        id: 't-2',
        title: 'Send offer letter to Casey Consultant',
        status: 'TODO',
        priority: 'CRITICAL',
        due_at: iso(43200_000),
        assignee_id: 'u-manager',
        assignee: { id: 'u-manager', email: 'morgan@test.local', full_name: 'Morgan Manager' },
        created_at: iso(-86400_000),
        updated_at: iso(-1800_000),
        comment_count: 0,
        tags: ['offers'],
      },
      {
        id: 't-3',
        title: 'Update bench list with new joiners',
        status: 'BACKLOG',
        priority: 'MEDIUM',
        due_at: iso(259200_000),
        assignee_id: null,
        assignee: null,
        created_at: iso(-259200_000),
        updated_at: iso(-259200_000),
        comment_count: 1,
        tags: [],
      },
    ],
  },
  '/tasks/metrics': {
    json: {
      total: 3,
      by_status: {
        BACKLOG: 1,
        TODO: 1,
        IN_PROGRESS: 1,
        BLOCKED: 0,
        REVIEW: 0,
        COMPLETED: 0,
        CANCELLED: 0,
      },
      by_priority: { LOW: 0, MEDIUM: 1, HIGH: 1, URGENT: 1 },
    },
  },

  // ── Dashboard summary ────────────────────────────────────────────────────
  '/reports/manager-summary': {
    json: {
      consultants_by_status: { ACTIVE: 8, PAUSED: 2, PLACED: 2 },
      recruiters_count: 3,
      active_jobs: 12,
      recent_applications: 24,
      applications_by_status: { SUBMITTED: 10, REVIEWING: 8, REJECTED: 4, OFFER: 2 },
      interviews_this_week: 5,
    },
  },

  // ── Jobs ─────────────────────────────────────────────────────────────────
  '/jobs/recommended': {
    json: {
      rows: [
        {
          id: 'j-1',
          title: 'Senior Full-Stack Engineer',
          company_name: 'Acme Corp',
          location: 'Austin, TX',
          remote: true,
          job_type: 'CONTRACT',
          level: 'SENIOR',
          rate_min: 85,
          rate_max: 110,
          description: 'Looking for a senior engineer to join our platform team.',
          required_skills: ['React', 'Node.js', 'PostgreSQL'],
          posted_at: iso(-86400_000),
          created_at: iso(-86400_000),
          is_active: true,
          match_score: 92,
          match_reasons: ['React expert', 'Node.js background'],
          source: 'greenhouse',
          external_id: 'gh-001',
        },
        {
          id: 'j-2',
          title: 'React Native Developer',
          company_name: 'TechStart',
          location: 'Remote',
          remote: true,
          job_type: 'FULLTIME',
          level: 'MID',
          rate_min: 70,
          rate_max: 90,
          description: 'Build mobile apps for iOS and Android.',
          required_skills: ['React Native', 'TypeScript'],
          posted_at: iso(-172800_000),
          created_at: iso(-172800_000),
          is_active: true,
          match_score: 78,
          match_reasons: ['Mobile expertise'],
          source: 'remoteok',
          external_id: 'ro-002',
        },
        {
          id: 'j-3',
          title: 'DevOps / Platform Engineer',
          company_name: 'CloudBase Inc',
          location: 'New York, NY',
          remote: false,
          job_type: 'CONTRACT',
          level: 'SENIOR',
          rate_min: 95,
          rate_max: 130,
          description: 'Own CI/CD pipelines and cloud infra.',
          required_skills: ['AWS', 'Terraform', 'Kubernetes'],
          posted_at: iso(-43200_000),
          created_at: iso(-43200_000),
          is_active: true,
          match_score: 65,
          match_reasons: ['AWS background'],
          source: 'lever',
          external_id: 'lv-003',
        },
      ],
      page: 1,
      per_page: 40,
      total: 3,
      total_pages: 1,
    },
  },
  '/job-sources': {
    json: [
      { id: 'src-1', name: 'Greenhouse', source_type: 'greenhouse', is_active: true },
      { id: 'src-2', name: 'RemoteOK', source_type: 'remoteok', is_active: true },
    ],
  },

  // ── Calendar events ───────────────────────────────────────────────────────
  '/calendar/events': {
    json: [
      {
        id: 'ev-1',
        title: 'Interview with Acme Corp',
        start: iso(3600_000),
        end: iso(7200_000),
        kind: 'interview',
        tone: 'info',
        durationMin: 60,
        calendar: 'interviews',
        meetingUrl: 'https://zoom.us/j/123456',
      },
      {
        id: 'ev-2',
        title: 'Standup — Platform Team',
        start: iso(86400_000),
        end: iso(88200_000),
        kind: 'meeting',
        tone: 'success',
        durationMin: 30,
        calendar: 'tasks',
      },
      {
        id: 'ev-3',
        title: 'Mock Loop: System Design',
        start: iso(172800_000),
        end: iso(176400_000),
        kind: 'interview',
        tone: 'warning',
        durationMin: 60,
        calendar: 'mock-loops',
      },
    ],
  },

  // ── Interviews ────────────────────────────────────────────────────────────
  '/interviews': {
    json: [
      {
        id: 'i-1',
        consultant_id: 'c-1',
        job_id: 'j-1',
        scheduled_at: iso(3600_000),
        status: 'SCHEDULED',
        interview_type: 'VIDEO',
        notes: 'System design round — bring examples.',
        consultant: { id: 'c-1', full_name: 'Casey Consultant' },
        job: { id: 'j-1', title: 'Senior Full-Stack Engineer', company_name: 'Acme Corp' },
      },
      {
        id: 'i-2',
        consultant_id: 'c-2',
        job_id: 'j-2',
        scheduled_at: iso(172800_000),
        status: 'SCHEDULED',
        interview_type: 'PHONE',
        notes: null,
        consultant: { id: 'c-2', full_name: 'Jordan Dev' },
        job: { id: 'j-2', title: 'React Native Developer', company_name: 'TechStart' },
      },
    ],
  },

  // ── Applications ──────────────────────────────────────────────────────────
  '/applications': {
    json: [
      {
        id: 'app-1',
        consultant_id: 'c-1',
        job_id: 'j-1',
        status: 'REVIEWING',
        applied_at: iso(-86400_000),
        consultant: { id: 'c-1', full_name: 'Casey Consultant' },
        job: { id: 'j-1', title: 'Senior Full-Stack Engineer', company_name: 'Acme Corp' },
        vendor: null,
        ats_link: null,
      },
      {
        id: 'app-2',
        consultant_id: 'c-2',
        job_id: 'j-2',
        status: 'SUBMITTED',
        applied_at: iso(-43200_000),
        consultant: { id: 'c-2', full_name: 'Jordan Dev' },
        job: { id: 'j-2', title: 'React Native Developer', company_name: 'TechStart' },
        vendor: null,
        ats_link: null,
      },
      {
        id: 'app-3',
        consultant_id: 'c-1',
        job_id: 'j-3',
        status: 'OFFER',
        applied_at: iso(-259200_000),
        consultant: { id: 'c-1', full_name: 'Casey Consultant' },
        job: { id: 'j-3', title: 'DevOps / Platform Engineer', company_name: 'CloudBase Inc' },
        vendor: null,
        ats_link: 'https://greenhouse.io/app/123',
      },
    ],
  },

  // ── Reports (404s so useReportData falls back to bundled mock JSON) ────────
  '/reports/pipeline': { status: 404, json: { error: 'not built' } },
  '/reports/recruiters': { status: 404, json: { error: 'not built' } },
  '/reports/consultants': { status: 404, json: { error: 'not built' } },
  '/reports/placements': { status: 404, json: { error: 'not built' } },
  '/reports/sources': { status: 404, json: { error: 'not built' } },
  '/reports/ai': { status: 404, json: { error: 'not built' } },
  '/reports/summary': {
    json: {
      total_consultants: 12,
      active_jobs: 12,
      applications_this_month: 24,
      interviews_this_week: 5,
    },
  },

  // ── Messages ──────────────────────────────────────────────────────────────
  '/messages/conversations': {
    json: [
      {
        peer: { id: 'u-2', email: 'bob@test.local', full_name: 'Bob Smith', role: 'RECRUITER' },
        last_message: {
          id: 'm-1',
          sender_id: 'u-2',
          recipient_id: 'u-manager',
          body: 'Hey, are you available for a quick call today?',
          read_at: null,
          created_at: iso(-600_000),
        },
        unread_count: 2,
      },
      {
        peer: {
          id: 'u-3',
          email: 'alice@test.local',
          full_name: 'Alice Recruiter',
          role: 'RECRUITER',
        },
        last_message: {
          id: 'm-2',
          sender_id: 'u-manager',
          recipient_id: 'u-3',
          body: "I'll send the candidate details shortly.",
          read_at: iso(-1800_000),
          created_at: iso(-3600_000),
        },
        unread_count: 0,
      },
    ],
  },
  '/messages/directory': { json: [] },

  // ── Reminders ────────────────────────────────────────────────────────────
  '/reminders': {
    json: [
      {
        id: 'r-1',
        title: 'Follow up with Acme Corp on offer letter',
        due_at: iso(86400_000),
        status: 'PENDING',
        description: 'Call HR contact and confirm paperwork timeline.',
      },
      {
        id: 'r-2',
        title: 'Check Casey interview feedback',
        due_at: iso(3600_000 * 4),
        status: 'PENDING',
        description: null,
      },
      {
        id: 'r-3',
        title: 'Update LinkedIn job postings',
        due_at: iso(-86400_000),
        status: 'DONE',
        description: null,
      },
    ],
  },

  // ── Training ─────────────────────────────────────────────────────────────
  '/training/my-training': {
    json: [
      {
        id: 'mt-1',
        course_id: 'course-1',
        status: 'IN_PROGRESS',
        progress_percentage: 65,
        due_date: iso(604800_000),
        course: {
          title: 'Advanced React Patterns',
          category: 'Frontend',
          compliance_category: null,
        },
      },
      {
        id: 'mt-2',
        course_id: 'course-2',
        status: 'NOT_STARTED',
        progress_percentage: 0,
        due_date: iso(1209600_000),
        course: {
          title: 'AWS Solutions Architect',
          category: 'Cloud',
          compliance_category: 'COMPLIANCE',
        },
      },
    ],
  },
  '/training/catalog': {
    json: [
      {
        id: 'course-1',
        title: 'Advanced React Patterns',
        category: 'Frontend',
        tags: ['React', 'TypeScript'],
        estimated_duration_hours: 6,
        compliance_category: null,
        difficulty: 'INTERMEDIATE',
        rating: 4.8,
        rating_count: 124,
        enrolled: 340,
        enrolled_by_me: true,
      },
      {
        id: 'course-2',
        title: 'AWS Solutions Architect',
        category: 'Cloud',
        tags: ['AWS', 'Infrastructure'],
        estimated_duration_hours: 12,
        compliance_category: 'COMPLIANCE',
        difficulty: 'ADVANCED',
        rating: 4.6,
        rating_count: 89,
        enrolled: 210,
        enrolled_by_me: true,
      },
      {
        id: 'course-3',
        title: 'System Design Fundamentals',
        category: 'Engineering',
        tags: ['Architecture', 'Scalability'],
        estimated_duration_hours: 8,
        compliance_category: null,
        difficulty: 'INTERMEDIATE',
        rating: 4.9,
        rating_count: 201,
        enrolled: 512,
        enrolled_by_me: false,
      },
    ],
  },
  '/training/continue': { body: 'null' },
  '/training/compliance': {
    json: {
      items: [
        {
          id: 'mt-2',
          course_id: 'course-2',
          status: 'NOT_STARTED',
          progress_percentage: 0,
          due_date: iso(1209600_000),
          course: { title: 'AWS Solutions Architect', compliance_category: 'COMPLIANCE' },
        },
      ],
      due_soon: 1,
    },
  },
  '/training/activity': {
    json: {
      series: [
        { date: iso(-6 * 86400_000).slice(0, 10), minutes: 30 },
        { date: iso(-5 * 86400_000).slice(0, 10), minutes: 45 },
        { date: iso(-4 * 86400_000).slice(0, 10), minutes: 0 },
        { date: iso(-3 * 86400_000).slice(0, 10), minutes: 60 },
        { date: iso(-2 * 86400_000).slice(0, 10), minutes: 20 },
        { date: iso(-1 * 86400_000).slice(0, 10), minutes: 90 },
        { date: iso(0).slice(0, 10), minutes: 15 },
      ],
      streak: 4,
      best: 7,
    },
  },
  '/training/achievements': {
    json: [
      {
        id: 'ach-1',
        title: 'First Course',
        description: 'Completed your first course.',
        earned_at: iso(-604800_000),
        icon: '🎓',
      },
      {
        id: 'ach-2',
        title: '7-Day Streak',
        description: 'Learned 7 days in a row.',
        earned_at: iso(-86400_000),
        icon: '🔥',
      },
    ],
  },
  '/training/plans/active': { body: 'null' },
  '/training/courses': { json: [] },

  // ── Consultants ───────────────────────────────────────────────────────────
  '/consultants': {
    json: [
      {
        id: 'c-1',
        marketing_status: 'ACTIVE',
        primary_skill: 'React / TypeScript',
        visa_status: 'H1B',
        total_experience_years: 7,
        current_location: 'Austin, TX',
        recruiter_id: 'rec-1',
        user: {
          id: 'u-c1',
          full_name: 'Casey Consultant',
          email: 'casey@test.local',
          group_id: null,
        },
        recruiter: {
          id: 'rec-1',
          team: 'West',
          user: { full_name: 'Bob Smith', email: 'bob@test.local' },
        },
      },
      {
        id: 'c-2',
        marketing_status: 'ACTIVE',
        primary_skill: 'React Native',
        visa_status: 'GC',
        total_experience_years: 4,
        current_location: 'Remote',
        recruiter_id: 'rec-1',
        user: { id: 'u-c2', full_name: 'Jordan Dev', email: 'jordan@test.local', group_id: null },
        recruiter: {
          id: 'rec-1',
          team: 'West',
          user: { full_name: 'Bob Smith', email: 'bob@test.local' },
        },
      },
      {
        id: 'c-3',
        marketing_status: 'PLACED',
        primary_skill: 'AWS / DevOps',
        visa_status: 'USC',
        total_experience_years: 9,
        current_location: 'New York, NY',
        recruiter_id: null,
        user: { id: 'u-c3', full_name: 'Sam Senior', email: 'sam@test.local', group_id: null },
        recruiter: null,
      },
    ],
  },

  // ── Recruiters (used by several pages) ───────────────────────────────────
  '/recruiters': {
    json: [
      {
        id: 'rec-1',
        team: 'West',
        user: { id: 'u-r1', full_name: 'Bob Smith', email: 'bob@test.local' },
      },
      {
        id: 'rec-2',
        team: 'East',
        user: { id: 'u-r2', full_name: 'Alice Recruiter', email: 'alice@test.local' },
      },
    ],
  },

  // ── Resumes (needs consultant list populated for the picker) ──────────────
  '/resumes': { json: [] },
};

test.describe('Mobile screenshots', () => {
  // Apply iPhone 12 emulation to all tests in this block via the fixture
  test.use({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1',
  });

  for (const pg of PAGES) {
    test(pg.name, async ({ page }) => {
      await seedSession(page, MANAGER);
      await mockApi(page, {
        profile: MANAGER,
        flags: { training: true, ai_match: true },
        handlers: MOCK_HANDLERS,
      });

      await page.goto(pg.path);
      await page.waitForLoadState('networkidle');

      fs.mkdirSync(OUT, { recursive: true });
      await page.screenshot({
        path: path.join(OUT, `${pg.name}.png`),
        fullPage: false,
      });
    });
  }
});
