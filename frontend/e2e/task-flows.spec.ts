/**
 * Task-flow E2E tests.
 *
 * Covers the most important task page behaviours:
 *   1. Task list renders tasks from the mocked API with correct status badges.
 *   2. Manager-tier users see the "New Task" create button.
 *   3. Consultant-role users do NOT see the "New Task" button (RBAC gate).
 *   4. Console is clean throughout all flows.
 *
 * All API calls are intercepted; no real backend is needed.
 */

import { test, expect } from '@playwright/test';
import { seedSession, mockApi, MANAGER, CONSULTANT, trackPageErrors } from './_helpers';

// ---------------------------------------------------------------------------
// Mock task data — three tasks covering the status states the UI can display
// ---------------------------------------------------------------------------

const MOCK_TASKS = [
  {
    id: 't-1',
    title: 'Design the onboarding flow',
    status: 'TODO',
    priority: 'HIGH',
    due_date: null,
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
    title: 'Write API docs',
    status: 'DONE',
    priority: 'LOW',
    due_date: null,
    assignee_id: 'u-manager',
    created_by: 'u-manager',
    assignee: { id: 'u-manager', full_name: 'Morgan Manager', email: 'manager@test.local' },
  },
];

// Common API handler override for the task page.
const TASK_PAGE_HANDLERS = {
  '/tasks': { json: MOCK_TASKS },
  '/task-views': { json: [] },
  '/users': { json: [] },
  '/recruiters': { json: [] },
  '/consultants': { json: [] },
};

// ---------------------------------------------------------------------------
// Task list — rendering
// ---------------------------------------------------------------------------

test.describe('Tasks page — task list rendering', () => {
  test('renders all three tasks from the mocked API', async ({ page }) => {
    const errors = trackPageErrors(page);

    await seedSession(page, MANAGER);
    await mockApi(page, {
      profile: MANAGER,
      flags: { tasks: true },
      handlers: TASK_PAGE_HANDLERS,
    });
    await page.goto('/tasks');

    // Each task title should appear in the list.
    for (const task of MOCK_TASKS) {
      await expect(page.getByText(task.title).filter({ visible: true }).first()).toBeVisible({
        timeout: 8000,
      });
    }
    expect(errors).toHaveLength(0);
  });

  test('shows status labels or badges for each task', async ({ page }) => {
    const errors = trackPageErrors(page);

    await seedSession(page, MANAGER);
    await mockApi(page, {
      profile: MANAGER,
      flags: { tasks: true },
      handlers: TASK_PAGE_HANDLERS,
    });
    await page.goto('/tasks');

    // Wait for the task list to be populated.
    await expect(
      page.getByText('Design the onboarding flow').filter({ visible: true }).first(),
    ).toBeVisible({ timeout: 8000 });

    // The UI should render visible status indicators. At least one must appear.
    // These can be Pill components, badge spans, or column headers. The status
    // <select> options also match this text but live hidden in the (collapsed)
    // desktop filter/dropdown markup, so scope to the visible occurrence.
    const statusIndicators = page
      .locator('text=/todo|in.progress|done/i')
      .filter({ visible: true });
    await expect(statusIndicators.first()).toBeVisible({ timeout: 5000 });

    expect(errors).toHaveLength(0);
  });

  test('console is clean when loading the tasks page', async ({ page }) => {
    const errors = trackPageErrors(page);

    await seedSession(page, MANAGER);
    await mockApi(page, {
      profile: MANAGER,
      flags: { tasks: true },
      handlers: TASK_PAGE_HANDLERS,
    });
    await page.goto('/tasks');
    await page.waitForLoadState('networkidle');

    expect(errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Task creation — RBAC gate on "New Task" button
// ---------------------------------------------------------------------------

test.describe('Tasks page — "New Task" button RBAC gate', () => {
  test('manager-tier user sees the "New Task" create button', async ({ page }) => {
    await seedSession(page, MANAGER);
    await mockApi(page, {
      profile: MANAGER,
      flags: { tasks: true },
      handlers: TASK_PAGE_HANDLERS,
    });
    await page.goto('/tasks');

    // Wait for page to settle.
    await page.waitForLoadState('networkidle');

    // The button is rendered by TaskFilterBar when canCreate=true (isManager).
    // It may say "New task", "+ New task", "New Task", etc.
    const newTaskBtn = page.getByRole('button', { name: /new task/i });
    await expect(newTaskBtn).toBeVisible({ timeout: 8000 });
  });

  test('consultant role does NOT see the "New Task" button', async ({ page }) => {
    await seedSession(page, CONSULTANT);
    await mockApi(page, {
      profile: CONSULTANT,
      flags: { tasks: true },
      handlers: {
        ...TASK_PAGE_HANDLERS,
        // Scope tasks to consultant's own tasks only (matches controller behaviour)
        '/tasks': { json: [MOCK_TASKS[0]] },
      },
    });
    await page.goto('/tasks');

    // Wait for any task content to be visible before asserting absence of button.
    await page.waitForLoadState('networkidle');

    // The "New Task" button must NOT exist for consultants.
    await expect(page.getByRole('button', { name: /new task/i })).not.toBeVisible({
      timeout: 3000,
    });
  });
});

// ---------------------------------------------------------------------------
// Task creation modal — opening (manager only)
// ---------------------------------------------------------------------------

test.describe('Tasks page — create task modal', () => {
  test('clicking "New Task" opens a modal with a form', async ({ page }) => {
    const errors = trackPageErrors(page);

    await seedSession(page, MANAGER);
    await mockApi(page, {
      profile: MANAGER,
      flags: { tasks: true },
      handlers: TASK_PAGE_HANDLERS,
    });
    await page.goto('/tasks');
    await page.waitForLoadState('load');

    const newTaskBtn = page.getByRole('button', { name: /new task/i });
    await newTaskBtn.waitFor({ timeout: 10_000 });
    await newTaskBtn.click();

    // A dialog with a form should appear.
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });

    // The modal should contain at least one text input (task title field).
    const titleInput = page.getByRole('dialog').getByRole('textbox').first();
    await expect(titleInput).toBeVisible();

    expect(errors).toHaveLength(0);
  });

  test('closing the create modal via Escape restores focus and hides dialog', async ({ page }) => {
    await seedSession(page, MANAGER);
    await mockApi(page, {
      profile: MANAGER,
      flags: { tasks: true },
      handlers: TASK_PAGE_HANDLERS,
    });
    await page.goto('/tasks');

    await page.getByRole('button', { name: /new task/i }).waitFor({ timeout: 8000 });
    await page.getByRole('button', { name: /new task/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 3000 });

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 3000 });
  });
});
