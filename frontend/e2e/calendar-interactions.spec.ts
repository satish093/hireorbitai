/**
 * Calendar / Interviews interactivity (mocked backend).
 *
 * Covers the interactive additions:
 *   1. Click an empty Week-view slot → the Schedule modal opens (click-to-create).
 *   2. Drag-to-reschedule fires PATCH /interviews/:id with a new scheduled_at.
 *
 * All API calls are intercepted; no real backend needed.
 */

import { test, expect } from '@playwright/test';
import { seedSession, mockApi, MANAGER, trackPageErrors } from './_helpers';
import { MOCK_CONSULTANTS } from './_mock-data';

// One interview at a fixed local time today so it renders in the day grid.
function todayAt(hour: number): string {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

const MOCK_INTERVIEW = {
  id: 'iv-1',
  type: 'TECHNICAL',
  scheduled_at: todayAt(10),
  duration_minutes: 60,
  interviewer: 'Dana Lee',
  meeting_url: 'https://zoom.us/test',
  is_mock: false,
  status: 'SCHEDULED',
  match_score: 80,
  consultant_id: 'c-1',
  consultant: { user: { full_name: 'Alice Chen' } },
};

test.describe('Calendar interactivity', () => {
  test('clicking an empty Week slot opens the Schedule modal', async ({ page }) => {
    const errors = trackPageErrors(page);

    await seedSession(page, MANAGER);
    await mockApi(page, {
      profile: MANAGER,
      flags: { interviews: true },
      handlers: {
        '/consultants': { json: MOCK_CONSULTANTS },
        '/interviews': { json: [] },
        '/reminders': { json: [] },
      },
    });

    await page.goto('/interviews?view=week');
    // SSE keeps the network busy, so wait for a concrete element, not idle.
    await expect(page.locator('[data-day]').first()).toBeVisible({ timeout: 8000 });

    // Click an empty day column to create at that slot.
    await page
      .locator('[data-day]')
      .first()
      .click({ position: { x: 20, y: 120 } });

    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('Schedule interview')).toBeVisible();

    expect(errors).toHaveLength(0);
  });

  test('dragging an interview in Day view PATCHes a new scheduled_at', async ({ page }) => {
    const errors = trackPageErrors(page);
    let patchedBody: any = null;

    await seedSession(page, MANAGER);
    await mockApi(page, {
      profile: MANAGER,
      flags: { interviews: true },
      handlers: {
        '/consultants': { json: MOCK_CONSULTANTS },
        '/interviews': { json: [MOCK_INTERVIEW] },
        '/reminders': { json: [] },
      },
    });
    // Capture the reschedule PATCH.
    await page.route('**/api/interviews/iv-1', async (route) => {
      patchedBody = route.request().postDataJSON();
      await route.fulfill({ json: { ...MOCK_INTERVIEW, scheduled_at: patchedBody?.scheduled_at } });
    });

    await page.goto('/interviews?view=day');

    const block = page.locator('[data-event="iv-1"]').first();
    await expect(block).toBeVisible({ timeout: 10000 });
    const box = await block.boundingBox();
    if (!box) throw new Error('event block has no bounding box');

    // Press on the block and drag down ~2 hours, then release.
    await page.mouse.move(box.x + box.width / 2, box.y + 8);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + 8 + 108, { steps: 8 });
    await page.mouse.up();

    await expect.poll(() => patchedBody?.scheduled_at ?? null, { timeout: 8000 }).not.toBeNull();

    expect(errors).toHaveLength(0);
  });
});
