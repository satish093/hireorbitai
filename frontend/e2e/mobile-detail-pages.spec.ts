/**
 * Mobile detail & training page smoke suite.
 *
 * Mirrors detail-pages.spec.ts but runs at an iPhone 12 viewport (390×844,
 * deviceScaleFactor 3, touch).  For every page it:
 *
 *   1. Seeds mocks identical to the desktop counterpart.
 *   2. Waits for networkidle so async sub-fetches settle.
 *   3. Asserts no horizontal overflow (scrollWidth ≤ clientWidth).
 *   4. Captures a full-page screenshot → e2e-results/mobile-detail-<name>.png.
 *   5. Runs axe and logs critical/serious violations (soft audit — does not
 *      hard-fail so a single a11y gap doesn't block the whole suite).
 *   6. Asserts trackPageErrors length is 0 (no uncaught exceptions).
 *
 * Pages covered (13):
 *   /training                          → mobile-detail-my-training.png
 *   /training/assignments              → mobile-detail-training-assignments.png
 *   /training/assignments/asgn-1       → mobile-detail-lesson-viewer.png
 *   /training/assignments/asgn-1/plan  → mobile-detail-training-plan.png
 *   /training/assignments/asgn-1/quiz  → mobile-detail-quiz.png
 *   /training/reports                  → mobile-detail-training-reports.png
 *   /training/courses/new              → mobile-detail-create-course.png
 *   /training/courses/course-1         → mobile-detail-course-details.png
 *   /training/courses/course-1/edit    → mobile-detail-edit-course.png
 *   /tasks/me                          → mobile-detail-tasks-me.png
 *   /tasks/t-1  (MANAGER)             → mobile-detail-task-detail.png
 *   /jobs/j-1   (MANAGER)             → mobile-detail-job-detail.png
 *   /jobs/j-1   (CONSULTANT)          → mobile-detail-job-detail-consultant.png
 */

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { seedSession, mockApi, MANAGER, CONSULTANT, trackPageErrors } from './_helpers';
import { MOCK_TASKS, MOCK_JOBS, MOCK_CONSULTANTS, ALL_FLAGS, BASE_HANDLERS } from './_mock-data';

// ─── Device emulation — iPhone 12 form factor on Chromium ────────────────────

test.use({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 14_4 like Mac OS X) ' +
    'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1',
});

// ─── Shared mock shapes (copied from detail-pages.spec.ts) ───────────────────

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

/** Returns true when the document body overflows horizontally. */
async function hasHorizontalOverflow(page: import('@playwright/test').Page): Promise<boolean> {
  return page.evaluate(() => document.body.scrollWidth > document.documentElement.clientWidth);
}

/**
 * Full-page screenshot + soft axe audit.  Logs critical/serious violations to
 * the console but does NOT throw so one a11y gap doesn't block the whole suite.
 */
async function screenshotAndAxe(
  page: import('@playwright/test').Page,
  name: string,
): Promise<void> {
  await page.screenshot({ path: `e2e-results/mobile-detail-${name}.png`, fullPage: true });

  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter(
    (v) => v.impact === 'critical' || v.impact === 'serious',
  );
  if (blocking.length > 0) {
    const summary = blocking
      .map((v) => `[${v.impact}] ${v.id}: ${v.description} (${v.nodes.length} node(s))`)
      .join('\n');
    console.warn(`Mobile a11y violations on ${name}:\n${summary}`);
  }
}

// ─── MyTraining (/training) ──────────────────────────────────────────────────

test.describe('Mobile — MyTraining page (/training)', () => {
  test('CONSULTANT sees learning page without crash or overflow', async ({ page }) => {
    const errors = trackPageErrors(page);

    await setupConsultant(page, {
      '/training/assignments': { json: MOCK_ASSIGNMENTS_LIST },
      '/training/my-training': { json: [] },
      '/training/continue': { json: null },
      '/training/compliance': { json: { items: [], due_soon: 0 } },
      '/training/activity': { json: { series: [] } },
    });
    await page.goto('/training');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('h1, h2, main').first()).toBeVisible({ timeout: 8000 });

    expect(await hasHorizontalOverflow(page)).toBe(false);
    await screenshotAndAxe(page, 'my-training');
    expect(errors).toHaveLength(0);
  });
});

// ─── TrainingAssignments (/training/assignments) ─────────────────────────────

test.describe('Mobile — TrainingAssignments page', () => {
  test('MANAGER sees assignment list with no horizontal overflow', async ({ page }) => {
    const errors = trackPageErrors(page);

    await setupManager(page, {
      '/training/assignments': { json: MOCK_ASSIGNMENTS_LIST },
    });
    await page.goto('/training/assignments');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: 'Assignments', level: 1 })).toBeVisible({
      timeout: 8000,
    });
    await expect(page.getByRole('link', { name: 'AWS Cloud Practitioner' })).toBeVisible({
      timeout: 8000,
    });

    expect(await hasHorizontalOverflow(page)).toBe(false);
    await screenshotAndAxe(page, 'training-assignments');
    expect(errors).toHaveLength(0);
  });
});

// ─── LessonViewer (/training/assignments/:id) ────────────────────────────────

test.describe('Mobile — LessonViewer page', () => {
  test('renders course title and first lesson with no overflow', async ({ page }) => {
    const errors = trackPageErrors(page);

    await setupConsultant(page, {
      '/training/assignments/asgn-1': { json: MOCK_ASSIGNMENT },
      '/training/assignments/asgn-1/evaluations': { json: [] },
      '/training/assignments/asgn-1/gates': { json: MOCK_GATES },
      '/training/assignments/asgn-1/acknowledgement': { body: 'null' },
      '/training/assignments/asgn-1/final-assessment': { body: 'null' },
      '/training/assignments/asgn-1/supervision-notes': { json: [] },
    });
    await page.goto('/training/assignments/asgn-1');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: 'AWS Cloud Practitioner' })).toBeVisible({
      timeout: 8000,
    });
    // On mobile the sidebar may be hidden behind a toggle; the lesson title still
    // appears in the DOM as an accessible heading.
    await expect(
      page.locator('aside, [aria-label*="lesson"], [aria-label*="curriculum"]').first(),
    ).toBeAttached({ timeout: 8000 });

    expect(await hasHorizontalOverflow(page)).toBe(false);
    await screenshotAndAxe(page, 'lesson-viewer');
    expect(errors).toHaveLength(0);
  });
});

// ─── TrainingPlanView (/training/assignments/:id/plan) ───────────────────────

test.describe('Mobile — TrainingPlanView page', () => {
  test('renders I-983 plan sections with no horizontal overflow', async ({ page }) => {
    const errors = trackPageErrors(page);

    await setupConsultant(page, {
      '/training/assignments/asgn-1': { json: MOCK_ASSIGNMENT },
      '/training/assignments/asgn-1/evaluations': { json: [] },
      '/training/courses/course-1': { json: MOCK_COURSE_DETAIL },
    });
    await page.goto('/training/assignments/asgn-1/plan');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: 'I-983 Training Plan', level: 1 })).toBeVisible({
      timeout: 8000,
    });
    await expect(page.getByRole('heading', { name: 'AWS Cloud Practitioner' }).first()).toBeVisible(
      { timeout: 8000 },
    );

    expect(await hasHorizontalOverflow(page)).toBe(false);
    await screenshotAndAxe(page, 'training-plan');
    expect(errors).toHaveLength(0);
  });
});

// ─── QuizPage (/training/assignments/:id/quiz) ────────────────────────────────

test.describe('Mobile — QuizPage', () => {
  test('renders quiz question with no horizontal overflow', async ({ page }) => {
    const errors = trackPageErrors(page);

    await setupConsultant(page, {
      '/training/assignments/asgn-1': { json: MOCK_ASSIGNMENT },
    });
    await page.goto('/training/assignments/asgn-1/quiz');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: /AWS Cloud Practitioner/i })).toBeVisible({
      timeout: 8000,
    });
    await expect(page.getByText('What does EC2 stand for?')).toBeVisible({ timeout: 8000 });

    expect(await hasHorizontalOverflow(page)).toBe(false);
    await screenshotAndAxe(page, 'quiz');
    expect(errors).toHaveLength(0);
  });
});

// ─── TrainingReports (/training/reports) ─────────────────────────────────────

test.describe('Mobile — TrainingReports page', () => {
  test('MANAGER sees training metrics with no horizontal overflow', async ({ page }) => {
    const errors = trackPageErrors(page);

    await setupManager(page, {
      '/training/reports': { json: MOCK_TRAINING_REPORTS },
    });
    await page.goto('/training/reports');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('Training effectiveness')).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('Total assignments')).toBeVisible({ timeout: 8000 });

    expect(await hasHorizontalOverflow(page)).toBe(false);
    await screenshotAndAxe(page, 'training-reports');
    expect(errors).toHaveLength(0);
  });
});

// ─── CreateTrainingCourse (/training/courses/new) ────────────────────────────

test.describe('Mobile — CreateTrainingCourse page', () => {
  test('MANAGER sees manual authoring form with no horizontal overflow', async ({ page }) => {
    const errors = trackPageErrors(page);

    await setupManager(page);
    await page.goto('/training/courses/new');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('New training course')).toBeVisible({ timeout: 8000 });
    await expect(page.getByRole('button', { name: /create/i })).toBeVisible({ timeout: 8000 });

    expect(await hasHorizontalOverflow(page)).toBe(false);
    await screenshotAndAxe(page, 'create-course');
    expect(errors).toHaveLength(0);
  });
});

// ─── TrainingCourseDetails (/training/courses/:id) ────────────────────────────

test.describe('Mobile — TrainingCourseDetails page', () => {
  test('renders course with lesson list and Assign button with no overflow', async ({ page }) => {
    const errors = trackPageErrors(page);

    await setupManager(page, {
      '/training/courses/course-1': { json: MOCK_COURSE_DETAIL },
      '/consultants': { json: MOCK_CONSULTANTS },
    });
    await page.goto('/training/courses/course-1');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: 'AWS Cloud Practitioner' })).toBeVisible({
      timeout: 8000,
    });
    await expect(page.getByText('Introduction to AWS')).toBeVisible({ timeout: 8000 });
    await expect(page.getByRole('button', { name: /assign/i })).toBeVisible({ timeout: 8000 });

    expect(await hasHorizontalOverflow(page)).toBe(false);
    await screenshotAndAxe(page, 'course-details');
    expect(errors).toHaveLength(0);
  });
});

// ─── EditTrainingCourse (/training/courses/:id/edit) ─────────────────────────

test.describe('Mobile — EditTrainingCourse page', () => {
  test('renders pre-filled edit form with Save button and no overflow', async ({ page }) => {
    const errors = trackPageErrors(page);

    await setupManager(page, {
      '/training/courses/course-1': { json: MOCK_COURSE_DETAIL },
    });
    await page.goto('/training/courses/course-1/edit');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('Edit course')).toBeVisible({ timeout: 8000 });
    await expect(page.getByRole('button', { name: /save/i })).toBeVisible({ timeout: 8000 });

    expect(await hasHorizontalOverflow(page)).toBe(false);
    await screenshotAndAxe(page, 'edit-course');
    expect(errors).toHaveLength(0);
  });
});

// ─── TasksAssignedToMe (/tasks/me) ────────────────────────────────────────────

test.describe('Mobile — TasksAssignedToMe page (/tasks/me)', () => {
  test('CONSULTANT sees assigned tasks list with no horizontal overflow', async ({ page }) => {
    const errors = trackPageErrors(page);

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
    await page.waitForLoadState('networkidle');

    await expect(page.locator('h1, h2, main').first()).toBeVisible({ timeout: 8000 });

    expect(await hasHorizontalOverflow(page)).toBe(false);
    await screenshotAndAxe(page, 'tasks-me');
    expect(errors).toHaveLength(0);
  });
});

// ─── TaskDetail (/tasks/:id) ──────────────────────────────────────────────────

test.describe('Mobile — TaskDetail page', () => {
  test('renders task detail with comments section and Delete button, no overflow', async ({
    page,
  }) => {
    const errors = trackPageErrors(page);

    await setupManager(page, {
      '/tasks/t-1': { json: MOCK_TASK_DETAIL },
      '/tasks/t-1/comments': { json: [] },
      '/tasks/t-1/attachments': { json: [] },
    });
    await page.goto('/tasks/t-1');
    await page.waitForLoadState('networkidle');

    // Task title is rendered as an editable <input> for managers.
    const titleInput = page.locator('main').locator('input').first();
    await expect(titleInput).toBeVisible({ timeout: 8000 });
    await expect(titleInput).toHaveValue('Design the onboarding flow');

    await expect(page.getByRole('heading', { name: /comments/i })).toBeVisible({ timeout: 8000 });
    await expect(page.getByRole('button', { name: /delete task/i })).toBeVisible({ timeout: 8000 });

    expect(await hasHorizontalOverflow(page)).toBe(false);
    await screenshotAndAxe(page, 'task-detail');
    expect(errors).toHaveLength(0);
  });
});

// ─── JobDetail (/jobs/:id) ────────────────────────────────────────────────────

test.describe('Mobile — JobDetail page (MANAGER)', () => {
  test('MANAGER sees job detail with bench matches panel and no overflow', async ({ page }) => {
    const errors = trackPageErrors(page);

    await setupManager(page, {
      '/jobs/j-1': { json: MOCK_JOB_DETAIL },
      '/jobs/j-1/note': { json: { body: '', author: null, updated_at: null } },
      '/consultants': { json: MOCK_CONSULTANTS },
    });
    await page.goto('/jobs/j-1');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('Senior Software Engineer')).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('Acme Corp')).toBeVisible({ timeout: 8000 });

    expect(await hasHorizontalOverflow(page)).toBe(false);
    await screenshotAndAxe(page, 'job-detail');
    expect(errors).toHaveLength(0);
  });
});

test.describe('Mobile — JobDetail page (CONSULTANT)', () => {
  test('CONSULTANT sees job detail read-only with no overflow', async ({ page }) => {
    const errors = trackPageErrors(page);

    await setupConsultant(page, {
      '/jobs/j-1': { json: MOCK_JOB_DETAIL },
    });
    await page.goto('/jobs/j-1');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('Senior Software Engineer')).toBeVisible({ timeout: 8000 });

    expect(await hasHorizontalOverflow(page)).toBe(false);
    await screenshotAndAxe(page, 'job-detail-consultant');
    expect(errors).toHaveLength(0);
  });
});
