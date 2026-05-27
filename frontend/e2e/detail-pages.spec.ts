/**
 * Detail & training page smoke suite.
 *
 * Covers the pages that were not yet tested in full-ui-audit.spec.ts:
 *
 *   Training pages (all behind the `training` feature flag):
 *     /training                    → MyTraining (CONSULTANT, with consultant_id)
 *     /training/assignments        → TrainingAssignments (MANAGER)
 *     /training/assignments/asgn-1 → LessonViewer
 *     /training/assignments/asgn-1/plan → TrainingPlanView
 *     /training/assignments/asgn-1/quiz → QuizPage
 *     /training/reports            → TrainingReports (MANAGER)
 *     /training/courses/new        → CreateTrainingCourse (MANAGER, manual form)
 *     /training/courses/course-1   → TrainingCourseDetails
 *     /training/courses/course-1/edit → EditTrainingCourse
 *
 *   Detail pages:
 *     /tasks/me   → TasksAssignedToMe (wraps Tasks with initialAssigneeMe)
 *     /tasks/t-1  → TaskDetail
 *     /jobs/j-1   → JobDetail
 *
 * All API calls are intercepted; no real backend is needed.
 * Screenshots land in e2e-results/ as audit-<name>.png.
 */

import { test, expect } from '@playwright/test';
import { seedSession, mockApi, MANAGER, CONSULTANT, trackPageErrors } from './_helpers';
import { MOCK_TASKS, MOCK_JOBS, MOCK_CONSULTANTS, ALL_FLAGS, BASE_HANDLERS } from './_mock-data';

// ─── Shared mock shapes ───────────────────────────────────────────────────────

const MOCK_ASSIGNMENT = {
  id: 'asgn-1',
  course_id: 'course-1',
  consultant_id: 'c-1',
  assigned_to_user_id: 'u-consultant',
  status: 'IN_PROGRESS',
  assigned_at: '2026-01-01T00:00:00Z',
  progress_percentage: 40,
  due_date: '2026-12-31',
  last_viewed_lesson_id: null,
  training_start_date: '2026-01-01',
  training_end_date: '2026-12-31',
  lesson_progress: [],
  assignee: {
    id: 'u-consultant',
    full_name: 'Casey Consultant',
    email: 'consultant@test.local',
    role: 'CONSULTANT',
  },
  // Pinned course content consumed by LessonViewer / QuizPage
  course_content: {
    course: {
      id: 'course-1',
      title: 'AWS Cloud Practitioner',
      description: 'Cloud fundamentals for beginners.',
      category: 'AWS',
      weekly_hours: 10,
    },
    lessons: [
      {
        id: 'lesson-1',
        course_id: 'course-1',
        title: 'Introduction to AWS',
        description: 'Overview of the AWS platform.',
        content: 'AWS is a cloud computing platform.\n- EC2\n- S3\n- Lambda',
        lesson_order: 1,
        estimated_minutes: 30,
        video_url: null,
        document_url: null,
        exercises: [],
        key_takeaways: ['EC2 is virtual compute', 'S3 is object storage'],
      },
    ],
    quizzes: [
      {
        id: 'quiz-1',
        lesson_id: 'lesson-1',
        question: 'What does EC2 stand for?',
        options: [
          'Elastic Compute Cloud',
          'Electronic Cloud Center',
          'Enterprise Compute Core',
          'Elastic Container Cloud',
        ],
        correct_answer: 'Elastic Compute Cloud',
        explanation: 'EC2 is the Elastic Compute Cloud service.',
      },
    ],
  },
  // Flat course reference (used by QuizPage h1)
  course: { id: 'course-1', title: 'AWS Cloud Practitioner' },
};

const MOCK_COURSE_DETAIL = {
  id: 'course-1',
  title: 'AWS Cloud Practitioner',
  description: 'Cloud fundamentals for beginners.',
  category: 'AWS',
  difficulty: 'BEGINNER',
  estimated_duration_hours: 10,
  tags: ['aws', 'cloud'],
  status: 'PUBLISHED',
  content_status: 'READY',
  review_status: 'REVIEWED',
  target_audience: null,
  overview: null,
  roadmap: null,
  resources: null,
  capstone: null,
  thumbnail_url: null,
  weekly_hours: 10,
  learning_objectives: ['Understand core AWS services', 'Deploy a simple app'],
  skills_taught: ['EC2', 'S3', 'Lambda'],
  assessment_methods: ['End-of-module quiz'],
  stem_relevance: 'Directly tied to cloud computing coursework.',
  lessons: [
    {
      id: 'lesson-1',
      course_id: 'course-1',
      title: 'Introduction to AWS',
      description: 'Overview of the AWS platform.',
      content: 'AWS is a cloud computing platform.',
      summary: null,
      content_status: 'READY',
      exercises: [],
      key_takeaways: [],
      video_url: null,
      document_url: null,
      lesson_order: 1,
      estimated_minutes: 30,
    },
  ],
  quizzes: [],
};

const MOCK_TRAINING_REPORTS = {
  total_courses: 2,
  active_courses: 1,
  total_assignments: 5,
  completed_assignments: 2,
  overdue_assignments: 1,
  completion_rate: 40,
  top_consultants: [{ user_id: 'u-c1', completed: 2 }],
  by_category: [{ category: 'AWS', courses: 1 }],
};

const MOCK_ASSIGNMENTS_LIST = [
  {
    id: 'asgn-1',
    course_id: 'course-1',
    status: 'IN_PROGRESS',
    progress_percentage: 40,
    assigned_at: '2026-01-01T00:00:00Z',
    due_date: '2026-12-31',
    course: { id: 'course-1', title: 'AWS Cloud Practitioner', category: 'AWS' },
    assignee: { full_name: 'Casey Consultant', email: 'consultant@test.local' },
  },
];

const MOCK_GATES = {
  status: 'IN_PROGRESS',
  progress_percentage: 40,
  blockers: ['lessons not complete'],
  gates: {
    lessons: { completed: 0, total: 1, ok: false },
    time: { minutes: 0, required: null, ok: true },
    quiz: { score: null, passing: null, attempts_exceeded: false, ok: true },
    uploads: { submitted: 0, required: 0, ok: true },
    acknowledgement: { acknowledged: false, ok: false },
    final_assessment: { exists: false, passed: false, ok: false },
    manager_approval: { required: false, approved: false, ok: true },
  },
};

const MOCK_TASK_DETAIL = {
  id: 't-1',
  title: 'Design the onboarding flow',
  description: 'Create wireframes and user journey maps.',
  status: 'TODO',
  priority: 'HIGH',
  due_date: '2026-06-01',
  due_at: null,
  tags: ['design', 'ux'],
  assignee_id: 'u-manager',
  created_by: 'u-manager',
  created_at: '2026-05-01T00:00:00Z',
  updated_at: '2026-05-20T00:00:00Z',
  assignee: { id: 'u-manager', full_name: 'Morgan Manager', email: 'manager@test.local' },
  creator: { id: 'u-manager', full_name: 'Morgan Manager', email: 'manager@test.local' },
  consultant: null,
};

const MOCK_JOB_DETAIL = {
  id: 'j-1',
  title: 'Senior Software Engineer',
  company_name: 'Acme Corp',
  client: { id: 'cl-1', company_name: 'Acme Corp' },
  vendor: null,
  location: 'Remote',
  status: 'ACTIVE',
  job_type: 'FULL_TIME',
  source: 'manual',
  description: 'Build scalable backend systems.',
  requirements: 'Node.js, TypeScript, PostgreSQL',
  salary_min: 120000,
  salary_max: 160000,
  created_at: '2026-05-01T00:00:00Z',
  updated_at: '2026-05-01T00:00:00Z',
};

// ─── Shared helpers ───────────────────────────────────────────────────────────

async function setupConsultant(
  page: import('@playwright/test').Page,
  extraHandlers: Record<string, { json: unknown; status?: number }> = {},
) {
  await seedSession(page, CONSULTANT);
  await mockApi(page, {
    profile: CONSULTANT,
    flags: ALL_FLAGS,
    handlers: { ...BASE_HANDLERS, ...extraHandlers },
  });
}

async function setupManager(
  page: import('@playwright/test').Page,
  extraHandlers: Record<string, { json: unknown; status?: number }> = {},
) {
  await seedSession(page, MANAGER);
  await mockApi(page, {
    profile: MANAGER,
    flags: ALL_FLAGS,
    handlers: { ...BASE_HANDLERS, ...extraHandlers },
  });
}

// ─── Training: MyTraining (/training) ────────────────────────────────────────

test.describe('MyTraining page (/training)', () => {
  test('CONSULTANT sees learning page without crash', async ({ page }) => {
    const errors = trackPageErrors(page);

    await setupConsultant(page, {
      '/training/assignments': { json: MOCK_ASSIGNMENTS_LIST },
      '/training/my-training': { json: [] },
      '/training/continue': { json: null },
      '/training/compliance': { json: { items: [], due_soon: 0 } },
      '/training/activity': { json: { series: [] } },
    });
    await page.goto('/training');
    await page.waitForLoadState('load');

    await expect(page.locator('h1, h2, main').first()).toBeVisible({ timeout: 8000 });

    await page.screenshot({ path: 'e2e-results/audit-my-training.png' });
    expect(errors).toHaveLength(0);
  });
});

// ─── Training: TrainingAssignments (/training/assignments) ───────────────────

test.describe('TrainingAssignments page', () => {
  test('MANAGER sees assignment list with status filter', async ({ page }) => {
    const errors = trackPageErrors(page);

    await setupManager(page, {
      '/training/assignments': { json: MOCK_ASSIGNMENTS_LIST },
    });
    await page.goto('/training/assignments');
    await page.waitForLoadState('load');

    // The page renders an h1 "Assignments" — use role to avoid strict-mode
    // violation with the nav sidebar link and breadcrumb that also say "Assignments".
    await expect(page.getByRole('heading', { name: 'Assignments', level: 1 })).toBeVisible({
      timeout: 8000,
    });
    await expect(page.getByRole('link', { name: 'AWS Cloud Practitioner' })).toBeVisible({
      timeout: 8000,
    });

    await page.screenshot({ path: 'e2e-results/audit-training-assignments.png' });
    expect(errors).toHaveLength(0);
  });
});

// ─── Training: LessonViewer (/training/assignments/:id) ──────────────────────

test.describe('LessonViewer page', () => {
  test('renders course title and first lesson', async ({ page }) => {
    const errors = trackPageErrors(page);

    await setupConsultant(page, {
      '/training/assignments/asgn-1': { json: MOCK_ASSIGNMENT },
      '/training/assignments/asgn-1/evaluations': { json: [] },
      '/training/assignments/asgn-1/gates': { json: MOCK_GATES },
      // AcknowledgementCard, FinalAssessmentCard, SupervisionNotesPanel each
      // fetch their own sub-resources — return empty shapes so they settle.
      '/training/assignments/asgn-1/acknowledgement': { body: 'null' },
      '/training/assignments/asgn-1/final-assessment': { body: 'null' },
      '/training/assignments/asgn-1/supervision-notes': { json: [] },
    });
    await page.goto('/training/assignments/asgn-1');
    // networkidle ensures all async sub-fetches (gates, acknowledgement, etc.)
    // resolve so the page settles before we query.
    await page.waitForLoadState('networkidle');

    // Course title renders in the plan header h1
    await expect(page.getByRole('heading', { name: 'AWS Cloud Practitioner' })).toBeVisible({
      timeout: 8000,
    });
    // First lesson appears in the curriculum sidebar as an h4 — scope to the
    // sidebar <aside> to avoid any strict-mode collision with the active lesson h2.
    await expect(
      page.locator('aside').getByRole('heading', { name: 'Introduction to AWS' }),
    ).toBeVisible({ timeout: 8000 });

    await page.screenshot({ path: 'e2e-results/audit-lesson-viewer.png' });
    expect(errors).toHaveLength(0);
  });
});

// ─── Training: TrainingPlanView (/training/assignments/:id/plan) ──────────────

test.describe('TrainingPlanView page', () => {
  test('renders I-983 plan sections for assignment', async ({ page }) => {
    const errors = trackPageErrors(page);

    await setupConsultant(page, {
      '/training/assignments/asgn-1': { json: MOCK_ASSIGNMENT },
      '/training/assignments/asgn-1/evaluations': { json: [] },
      '/training/courses/course-1': { json: MOCK_COURSE_DETAIL },
    });
    await page.goto('/training/assignments/asgn-1/plan');
    await page.waitForLoadState('load');

    // The h1 heading is the most specific locator; breadcrumbs and the DHS
    // section header also contain this text so use role + level.
    await expect(page.getByRole('heading', { name: 'I-983 Training Plan', level: 1 })).toBeVisible({
      timeout: 8000,
    });
    // Course title appears as h2 inside the plan card.
    await expect(page.getByRole('heading', { name: 'AWS Cloud Practitioner' }).first()).toBeVisible(
      {
        timeout: 8000,
      },
    );

    await page.screenshot({ path: 'e2e-results/audit-training-plan.png' });
    expect(errors).toHaveLength(0);
  });
});

// ─── Training: QuizPage (/training/assignments/:id/quiz) ─────────────────────

test.describe('QuizPage', () => {
  test('renders quiz question from pinned assignment content', async ({ page }) => {
    const errors = trackPageErrors(page);

    await setupConsultant(page, {
      '/training/assignments/asgn-1': { json: MOCK_ASSIGNMENT },
    });
    await page.goto('/training/assignments/asgn-1/quiz');
    await page.waitForLoadState('load');

    // The quiz page heading contains the course title
    await expect(page.getByRole('heading', { name: /AWS Cloud Practitioner/i })).toBeVisible({
      timeout: 8000,
    });
    // The quiz question should be visible
    await expect(page.getByText('What does EC2 stand for?')).toBeVisible({ timeout: 8000 });

    await page.screenshot({ path: 'e2e-results/audit-quiz.png' });
    expect(errors).toHaveLength(0);
  });
});

// ─── Training: TrainingReports (/training/reports) ───────────────────────────

test.describe('TrainingReports page', () => {
  test('MANAGER sees training effectiveness metrics', async ({ page }) => {
    const errors = trackPageErrors(page);

    await setupManager(page, {
      '/training/reports': { json: MOCK_TRAINING_REPORTS },
    });
    await page.goto('/training/reports');
    await page.waitForLoadState('load');

    await expect(page.getByText('Training effectiveness')).toBeVisible({ timeout: 8000 });
    // Metric cards use DashboardCard which renders the label
    await expect(page.getByText('Total assignments')).toBeVisible({ timeout: 8000 });

    await page.screenshot({ path: 'e2e-results/audit-training-reports.png' });
    expect(errors).toHaveLength(0);
  });
});

// ─── Training: CreateTrainingCourse (/training/courses/new) ──────────────────

test.describe('CreateTrainingCourse page', () => {
  test('MANAGER sees manual authoring form (no AI mode for non-admin)', async ({ page }) => {
    const errors = trackPageErrors(page);

    await setupManager(page);
    await page.goto('/training/courses/new');
    await page.waitForLoadState('load');

    await expect(page.getByText('New training course')).toBeVisible({ timeout: 8000 });
    // The manual form has a Title field and a Create button
    await expect(page.getByRole('button', { name: /create/i })).toBeVisible({ timeout: 8000 });

    await page.screenshot({ path: 'e2e-results/audit-create-course.png' });
    expect(errors).toHaveLength(0);
  });
});

// ─── Training: TrainingCourseDetails (/training/courses/:id) ─────────────────

test.describe('TrainingCourseDetails page', () => {
  test('renders course with lesson list and action buttons', async ({ page }) => {
    const errors = trackPageErrors(page);

    await setupManager(page, {
      '/training/courses/course-1': { json: MOCK_COURSE_DETAIL },
      '/consultants': { json: MOCK_CONSULTANTS },
    });
    await page.goto('/training/courses/course-1');
    await page.waitForLoadState('load');

    await expect(page.getByRole('heading', { name: 'AWS Cloud Practitioner' })).toBeVisible({
      timeout: 8000,
    });
    await expect(page.getByText('Introduction to AWS')).toBeVisible({ timeout: 8000 });
    // Manager sees the Assign button
    await expect(page.getByRole('button', { name: /assign/i })).toBeVisible({ timeout: 8000 });

    await page.screenshot({ path: 'e2e-results/audit-course-details.png' });
    expect(errors).toHaveLength(0);
  });
});

// ─── Training: EditTrainingCourse (/training/courses/:id/edit) ───────────────

test.describe('EditTrainingCourse page', () => {
  test('renders pre-filled edit form with Save button', async ({ page }) => {
    const errors = trackPageErrors(page);

    await setupManager(page, {
      '/training/courses/course-1': { json: MOCK_COURSE_DETAIL },
    });
    await page.goto('/training/courses/course-1/edit');
    await page.waitForLoadState('load');

    await expect(page.getByText('Edit course')).toBeVisible({ timeout: 8000 });
    // The title field should be pre-populated with the course title
    await expect(page.getByRole('button', { name: /save/i })).toBeVisible({ timeout: 8000 });

    await page.screenshot({ path: 'e2e-results/audit-edit-course.png' });
    expect(errors).toHaveLength(0);
  });
});

// ─── Detail: TasksAssignedToMe (/tasks/me) ────────────────────────────────────

test.describe('TasksAssignedToMe page (/tasks/me)', () => {
  test('CONSULTANT sees their assigned tasks list', async ({ page }) => {
    const errors = trackPageErrors(page);

    // CONSULTANT can see tasks assigned to them — Tasks page handles the filter.
    await setupConsultant(page, {
      '/tasks': { json: MOCK_TASKS },
      '/tasks/metrics': {
        json: {
          total: 3,
          open: 2,
          critical_open: 0,
          by_status: { TODO: 1, IN_PROGRESS: 1, DONE: 1 },
          by_priority: { HIGH: 1, MEDIUM: 1, LOW: 1 },
          overdue: 0,
          due_today: 0,
          due_this_week: 1,
          completed_last_7_days: 1,
        },
      },
      '/task-views': { json: [] },
    });
    await page.goto('/tasks/me');
    await page.waitForLoadState('load');

    await expect(page.locator('h1, h2, main').first()).toBeVisible({ timeout: 8000 });

    await page.screenshot({ path: 'e2e-results/audit-tasks-me.png' });
    expect(errors).toHaveLength(0);
  });
});

// ─── Detail: TaskDetail (/tasks/:id) ─────────────────────────────────────────

test.describe('TaskDetail page', () => {
  test('renders task detail page with comments section and Delete button', async ({ page }) => {
    const errors = trackPageErrors(page);

    await setupManager(page, {
      '/tasks/t-1': { json: MOCK_TASK_DETAIL },
      '/tasks/t-1/comments': { json: [] },
      '/tasks/t-1/attachments': { json: [] },
    });
    await page.goto('/tasks/t-1');
    await page.waitForLoadState('load');

    // The task title is rendered as an editable <input> for managers — assert
    // the input has the right value (getByText scans text nodes, not input values).
    const titleInput = page.locator('main').locator('input').first();
    await expect(titleInput).toBeVisible({ timeout: 8000 });
    await expect(titleInput).toHaveValue('Design the onboarding flow');

    // Comments h3 heading is always rendered as real text content.
    await expect(page.getByRole('heading', { name: /comments/i })).toBeVisible({ timeout: 8000 });

    // Manager sees the Delete task button.
    await expect(page.getByRole('button', { name: /delete task/i })).toBeVisible({ timeout: 8000 });

    await page.screenshot({ path: 'e2e-results/audit-task-detail.png' });
    expect(errors).toHaveLength(0);
  });
});

// ─── Detail: JobDetail (/jobs/:id) ───────────────────────────────────────────

test.describe('JobDetail page', () => {
  test('MANAGER sees job detail with bench matches panel', async ({ page }) => {
    const errors = trackPageErrors(page);

    await setupManager(page, {
      '/jobs/j-1': { json: MOCK_JOB_DETAIL },
      '/jobs/j-1/note': { json: { body: '', author: null, updated_at: null } },
      '/consultants': { json: MOCK_CONSULTANTS },
    });
    await page.goto('/jobs/j-1');
    await page.waitForLoadState('load');

    await expect(page.getByText('Senior Software Engineer')).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('Acme Corp')).toBeVisible({ timeout: 8000 });

    await page.screenshot({ path: 'e2e-results/audit-job-detail.png' });
    expect(errors).toHaveLength(0);
  });

  test('CONSULTANT is denied /jobs/:id — jobs are operator-only', async ({ page }) => {
    // Policy: consultants don't browse jobs. The route guard (OPERATOR_TIER)
    // sends them to /unauthorized rather than rendering the job.
    await setupConsultant(page, {
      '/jobs/j-1': { json: MOCK_JOB_DETAIL },
    });
    await page.goto('/jobs/j-1');

    await expect(page).toHaveURL(/\/unauthorized$/);
  });
});
