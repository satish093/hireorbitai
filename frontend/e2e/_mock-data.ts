/**
 * Shared mock data and API handlers used by full-ui-audit.spec.ts and
 * mobile-audit.spec.ts. All shapes match the actual backend response types.
 */

export const MOCK_TASKS = [
  {
    id: 't-1',
    title: 'Design the onboarding flow',
    status: 'TODO',
    priority: 'HIGH',
    due_date: '2026-06-01',
    assignee_id: 'u-manager',
    created_by: 'u-manager',
    assignee: { id: 'u-manager', full_name: 'Morgan Manager', email: 'manager@test.local' },
  },
  {
    id: 't-2',
    title: 'Implement auth middleware',
    status: 'IN_PROGRESS',
    priority: 'MEDIUM',
    due_date: null,
    assignee_id: 'u-manager',
    created_by: 'u-manager',
    assignee: { id: 'u-manager', full_name: 'Morgan Manager', email: 'manager@test.local' },
  },
  {
    id: 't-3',
    title: 'Write API documentation',
    status: 'DONE',
    priority: 'LOW',
    due_date: null,
    assignee_id: 'u-manager',
    created_by: 'u-manager',
    assignee: { id: 'u-manager', full_name: 'Morgan Manager', email: 'manager@test.local' },
  },
];

export const MOCK_TASK_METRICS = {
  total: 3,
  open: 2,
  critical_open: 0,
  by_status: {
    BACKLOG: 0,
    TODO: 1,
    IN_PROGRESS: 1,
    BLOCKED: 0,
    REVIEW: 0,
    COMPLETED: 1,
    CANCELLED: 0,
    DONE: 1,
  },
  by_priority: { CRITICAL: 0, HIGH: 1, MEDIUM: 1, LOW: 1 },
  overdue: 0,
  due_today: 0,
  due_this_week: 1,
  completed_last_7_days: 1,
};

export const MOCK_RECRUITERS = [
  {
    id: 'r-1',
    team: 'Team Alpha',
    user: { id: 'u-r1', full_name: 'Riley Recruiter', email: 'riley@test.local' },
  },
  {
    id: 'r-2',
    team: 'Team Beta',
    user: { id: 'u-r2', full_name: 'Sam Recruiter', email: 'sam@test.local' },
  },
];

export const MOCK_CONSULTANTS = [
  {
    id: 'c-1',
    marketing_status: 'ACTIVE',
    primary_skill: 'Java',
    visa_status: 'H1B',
    total_experience_years: 5,
    current_location: 'New York, NY',
    recruiter_id: 'r-1',
    user: { id: 'u-c1', full_name: 'Alice Chen', email: 'alice@test.local' },
    recruiter: {
      id: 'r-1',
      team: 'Team Alpha',
      user: { id: 'u-r1', full_name: 'Riley Recruiter', email: 'riley@test.local' },
    },
  },
  {
    id: 'c-2',
    marketing_status: 'PAUSED',
    primary_skill: 'Python',
    visa_status: 'OPT',
    total_experience_years: 3,
    current_location: 'Austin, TX',
    recruiter_id: null,
    user: { id: 'u-c2', full_name: 'Bob Kim', email: 'bob@test.local' },
    recruiter: null,
  },
  {
    id: 'c-3',
    marketing_status: 'PLACED',
    primary_skill: 'React',
    visa_status: 'GC',
    total_experience_years: 7,
    current_location: 'Chicago, IL',
    recruiter_id: 'r-1',
    user: { id: 'u-c3', full_name: 'Carol Patel', email: 'carol@test.local' },
    recruiter: {
      id: 'r-1',
      team: 'Team Alpha',
      user: { id: 'u-r1', full_name: 'Riley Recruiter', email: 'riley@test.local' },
    },
  },
];

export const MOCK_INTERVIEWS = [
  {
    id: 'iv-1',
    type: 'Phone Screen',
    scheduled_at: '2026-05-25T14:00:00.000Z',
    duration_minutes: 45,
    interviewer: 'David Smith',
    meeting_url: 'https://zoom.us/test',
    is_mock: false,
    status: 'scheduled',
    match_score: 85,
    consultant: { user: { full_name: 'Alice Chen' } },
  },
  {
    id: 'iv-2',
    type: 'Technical',
    scheduled_at: '2026-05-27T10:00:00.000Z',
    duration_minutes: 60,
    interviewer: 'Eve Johnson',
    meeting_url: null,
    is_mock: true,
    status: 'scheduled',
    match_score: 72,
    consultant: { user: { full_name: 'Bob Kim' } },
  },
];

export const MOCK_REMINDERS = [
  {
    id: 'rem-1',
    title: 'Follow up with Alice re: Google offer',
    due_at: '2026-05-28T09:00:00.000Z',
    status: 'ACTIVE',
    description: 'Check if she received the offer letter.',
  },
  {
    id: 'rem-2',
    title: 'Send resume to Acme Corp',
    due_at: '2026-05-30T17:00:00.000Z',
    status: 'ACTIVE',
    description: '',
  },
  {
    id: 'rem-3',
    title: 'Verify Bob visa extension',
    due_at: '2026-05-15T12:00:00.000Z',
    status: 'DONE',
    description: '',
  },
];

export const MOCK_APPLICATIONS = [
  {
    id: 'app-1',
    consultant: { user: { full_name: 'Alice Chen', email: 'alice@test.local' } },
    job: { title: 'Senior Java Developer' },
    vendor: { company_name: 'TechStaff Inc' },
    ats_score: 88,
    submitted_at: '2026-05-20T10:00:00.000Z',
    status: 'SUBMITTED',
  },
  {
    id: 'app-2',
    consultant: { user: { full_name: 'Bob Kim', email: 'bob@test.local' } },
    job: { title: 'Python Data Engineer' },
    vendor: { company_name: 'DataBridge LLC' },
    ats_score: 75,
    submitted_at: '2026-05-18T14:00:00.000Z',
    status: 'INTERVIEW',
  },
];

// Backend returns embedded client/vendor joins alongside top-level company_name.
export const MOCK_JOBS = [
  {
    id: 'j-1',
    title: 'Senior Software Engineer',
    company_name: 'Acme Corp',
    client: { id: 'cl-1', company_name: 'Acme Corp' },
    vendor: null,
    location: 'Remote',
    status: 'ACTIVE',
    job_type: 'FULL_TIME',
    source: 'manual',
    created_at: '2026-05-01T00:00:00Z',
    updated_at: '2026-05-01T00:00:00Z',
  },
  {
    id: 'j-2',
    title: 'Frontend Developer',
    company_name: 'Beta Inc',
    client: { id: 'cl-2', company_name: 'Beta Inc' },
    vendor: null,
    location: 'New York, NY',
    status: 'ACTIVE',
    job_type: 'CONTRACT',
    source: 'jsearch',
    created_at: '2026-05-10T00:00:00Z',
    updated_at: '2026-05-10T00:00:00Z',
  },
];

export const MOCK_CONVERSATIONS = [
  {
    peer: {
      id: 'u-c1',
      email: 'alice@test.local',
      full_name: 'Alice Chen',
      role: 'CONSULTANT',
      last_seen_at: '2026-05-22T10:00:00.000Z',
    },
    last_message: {
      id: 'msg-1',
      sender_id: 'u-c1',
      recipient_id: 'u-manager',
      body: 'Can we schedule a call this week?',
      read_at: null,
      created_at: '2026-05-22T10:00:00.000Z',
    },
    unread_count: 1,
  },
  {
    peer: {
      id: 'u-r1',
      email: 'riley@test.local',
      full_name: 'Riley Recruiter',
      role: 'RECRUITER',
      last_seen_at: '2026-05-21T15:00:00.000Z',
    },
    last_message: {
      id: 'msg-2',
      sender_id: 'u-manager',
      recipient_id: 'u-r1',
      body: 'Please review the consultant profiles.',
      read_at: '2026-05-21T15:05:00.000Z',
      created_at: '2026-05-21T15:00:00.000Z',
    },
    unread_count: 0,
  },
];

export const MOCK_COURSES = [
  {
    id: 'course-1',
    title: 'AWS Cloud Practitioner',
    description: 'Cloud fundamentals for beginners.',
    category: 'AWS',
    level: 'beginner',
    status: 'PUBLISHED',
    duration_hours: 10,
    created_by: 'u-manager',
    created_at: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'course-2',
    title: 'Node.js Advanced Patterns',
    description: 'Deep dive into async Node.js.',
    category: 'Node.js',
    level: 'advanced',
    status: 'PUBLISHED',
    duration_hours: 15,
    created_by: 'u-manager',
    created_at: '2026-02-01T00:00:00.000Z',
  },
];

// Backend-accurate ResumeVersion shape (no label field; UI shows v{version}).
export const MOCK_RESUMES_FOR_C1 = [
  {
    id: 'res-1',
    consultant_id: 'c-1',
    version: 1,
    file_name: 'alice-resume-v1.pdf',
    ai_score: 82,
    is_current: true,
    created_at: '2026-05-01T00:00:00.000Z',
    tailored_for_job_id: null,
    tailored_job: null,
  },
  {
    id: 'res-2',
    consultant_id: 'c-1',
    version: 2,
    file_name: 'alice-resume-v2.pdf',
    ai_score: 90,
    is_current: false,
    created_at: '2026-05-15T00:00:00.000Z',
    tailored_for_job_id: null,
    tailored_job: null,
  },
];

export const MANAGER_SUMMARY = {
  consultants_by_status: { ACTIVE: 1, PAUSED: 1, PLACED: 1 },
  recruiters_count: 2,
  active_jobs: 2,
  last_7_day_applications: 2,
  applications_by_status: { SUBMITTED: 1, INTERVIEW: 1 },
};

export const ALL_FLAGS = {
  tasks: true,
  messages: true,
  training: true,
  interviews: true,
  reminders: true,
  reports: true,
  ai_email: true,
};

export const BASE_HANDLERS = {
  '/tasks': { json: MOCK_TASKS },
  '/tasks/metrics': { json: MOCK_TASK_METRICS },
  '/task-views': { json: [] },
  '/messages/conversations': { json: MOCK_CONVERSATIONS },
  '/messages/directory': { json: [] },
  '/jobs': { json: MOCK_JOBS },
  '/jobs/recommended': {
    json: { rows: MOCK_JOBS, page: 1, per_page: 40, total: 2, total_pages: 1 },
  },
  '/job-sources': { json: [] },
  '/consultants': { json: MOCK_CONSULTANTS },
  '/recruiters': { json: MOCK_RECRUITERS },
  '/users': { json: [] },
  '/reminders': { json: MOCK_REMINDERS },
  '/interviews': { json: MOCK_INTERVIEWS },
  '/activity': { json: [] },
  '/applications': { json: MOCK_APPLICATIONS },
  '/vendors': { json: [] },
  '/reports/manager-summary': { json: MANAGER_SUMMARY },
  '/reports/pipeline': { status: 404, json: { error: 'Not found' } },
  '/reports/recruiters': { status: 404, json: { error: 'Not found' } },
  '/reports/consultants': { status: 404, json: { error: 'Not found' } },
  '/reports/placements': { status: 404, json: { error: 'Not found' } },
  '/reports/sources': { status: 404, json: { error: 'Not found' } },
  '/reports/ai': { status: 404, json: { error: 'Not found' } },
  '/training/courses': { json: MOCK_COURSES },
  '/training/assignments': { json: [] },
  '/resumes/consultant/c-1': { json: MOCK_RESUMES_FOR_C1 },
};
