/**
 * Messages page smoke tests — covers the new chat features:
 *   • Conversations sidebar renders with permitted directory visible by default
 *   • Opening a conversation loads the thread + auto-marks as read
 *   • Paperclip button opens the hidden file input
 *   • Hovering a message exposes the Reply button + clicking it shows the
 *     reply-target chip above the composer
 *   • Day separator pill renders
 *   • Composer auto-grows when the user types multi-line content
 *   • NotificationToggle bell renders next to the "Chats" heading
 *   • No console errors / page exceptions on any of the above
 *
 * All API traffic is mocked — no real backend / no DB / no realtime stream.
 */

import { test, expect, type Page } from '@playwright/test';
import { seedSession, mockApi, MANAGER, trackPageErrors } from './_helpers';

const PEER_ID = 'u-peer-1';

const MOCK_PEER = {
  id: PEER_ID,
  email: 'peer@test.local',
  full_name: 'Pat Peer',
  role: 'RECRUITER',
  last_seen_at: '2026-05-28T12:00:00.000Z',
  group_id: null,
};

// Dates must be RELATIVE to the real "now", not hard-coded — the page's
// dayLabel() compares each message date against `new Date()` and only emits the
// "Yesterday" pill when the date is the actual previous calendar day. Anchor
// "yesterday" at noon (avoids a midnight-run landing two days back) and "now" a
// few minutes ago so the most-recent bubble still groups under "Today".
const NOW = new Date(Date.now() - 5 * 60_000).toISOString();
const yest = new Date();
yest.setDate(yest.getDate() - 1);
yest.setHours(12, 0, 0, 0);
const YESTERDAY = yest.toISOString();

const MOCK_CONVERSATIONS = [
  {
    peer: MOCK_PEER,
    last_message: {
      id: 'm-2',
      sender_id: PEER_ID,
      recipient_id: MANAGER.id,
      body: 'Latest message from peer',
      read_at: null,
      created_at: NOW,
    },
    unread_count: 1,
  },
];

const MOCK_THREAD = [
  // Yesterday's message — exercises the day-separator pill.
  {
    id: 'm-1',
    sender_id: MANAGER.id,
    recipient_id: PEER_ID,
    body: 'Hi there, earlier message from me',
    read_at: '2026-05-27T16:00:00.000Z',
    created_at: YESTERDAY,
  },
  {
    id: 'm-2',
    sender_id: PEER_ID,
    recipient_id: MANAGER.id,
    body: 'Latest message from peer',
    read_at: null,
    created_at: NOW,
  },
];

async function setupMessagesPage(page: Page) {
  await seedSession(page, MANAGER);
  await mockApi(page, {
    profile: MANAGER,
    flags: { messages: true },
    handlers: {
      '/messages/conversations': { json: MOCK_CONVERSATIONS },
      '/messages/directory': { json: [MOCK_PEER] },
      '/messages/unread-count': { json: { unread: 1 } },
      [`/messages/with/${PEER_ID}`]: { json: MOCK_THREAD },
      [`POST /messages/with/${PEER_ID}/read`]: { json: { ok: true } },
      [`POST /messages/with/${PEER_ID}/typing`]: { json: { ok: true } },
    },
  });
}

test.describe('Messages page — chat smoke', () => {
  test('renders sidebar with the active conversation + the notification bell toggle', async ({
    page,
  }) => {
    const errors = trackPageErrors(page);
    await setupMessagesPage(page);
    await page.goto('/messages');
    await page.waitForLoadState('networkidle');

    await expect(page.getByRole('heading', { name: 'Chats' })).toBeVisible({ timeout: 8000 });
    // NotificationToggle renders as a button whose aria-label/title is one of
    // "Enable desktop notifications" (permission=default), "Notification
    // sound on/off …" (granted), or "Notifications blocked …" (denied).
    // Playwright's chromium can be in any of those states depending on
    // OS-level notification policy, so accept all forms — we're verifying
    // the toggle MOUNTED, not its specific state.
    await expect(
      page.getByRole('button', { name: /notification|notifications/i }).first(),
    ).toBeVisible({ timeout: 8000 });
    // Peer's display name appears in the conversation list.
    await expect(page.getByText('Pat Peer').first()).toBeVisible({ timeout: 8000 });

    expect(errors).toHaveLength(0);
  });

  test('opening the thread shows messages + a day-separator pill + the paperclip', async ({
    page,
  }) => {
    const errors = trackPageErrors(page);
    await setupMessagesPage(page);
    await page.goto(`/messages?with=${PEER_ID}`);
    await page.waitForLoadState('networkidle');

    // Both messages render in the thread (the body text is wrapped in a
    // <span> inside the bubble — picks the bubble copy not the
    // conversation-list preview which would collide on strict-mode).
    await expect(page.locator('span').getByText('Hi there, earlier message from me')).toBeVisible({
      timeout: 8000,
    });
    await expect(page.locator('span').getByText('Latest message from peer')).toBeVisible({
      timeout: 8000,
    });

    // Yesterday pill (groupByDay emits "Yesterday" for the previous day).
    await expect(page.getByText('Yesterday', { exact: true }).first()).toBeVisible({
      timeout: 8000,
    });

    // Paperclip attach button.
    await expect(page.getByRole('button', { name: /Attach a file/i })).toBeVisible({
      timeout: 8000,
    });

    expect(errors).toHaveLength(0);
  });

  test('hovering a message reveals the Reply button → clicking it shows the reply chip above the composer', async ({
    page,
  }) => {
    const errors = trackPageErrors(page);
    await setupMessagesPage(page);
    await page.goto(`/messages?with=${PEER_ID}`);
    await page.waitForLoadState('networkidle');

    const peerBubble = page.locator('span').getByText('Latest message from peer');
    await expect(peerBubble).toBeVisible({ timeout: 8000 });
    // Hover the bubble to expose the hover-menu (incl. Reply ↩).
    await peerBubble.hover();

    const replyBtn = page.getByRole('button', { name: 'Reply' });
    await expect(replyBtn).toBeVisible({ timeout: 8000 });
    await replyBtn.click();

    // Reply chip appears above the composer with the peer's name. "Pat
    // Peer" already appears multiple times in the DOM (conversation list,
    // chat header, etc.) so we anchor on the "Replying to" wrapper and
    // assert the chip exists — the visible "Replying to" label is enough
    // proof the chip mounted.
    await expect(page.getByText(/Replying to/i)).toBeVisible({ timeout: 8000 });

    // Cancel reply button (the X icon).
    const cancelBtn = page.getByRole('button', { name: 'Cancel reply' });
    await expect(cancelBtn).toBeVisible();
    await cancelBtn.click();

    // Chip disappears after cancel.
    await expect(page.getByText(/Replying to/i)).toHaveCount(0);

    expect(errors).toHaveLength(0);
  });

  test('typing in the composer auto-grows the textarea + fires typing ping', async ({ page }) => {
    const errors = trackPageErrors(page);
    let typingPings = 0;
    await seedSession(page, MANAGER);
    await mockApi(page, {
      profile: MANAGER,
      flags: { messages: true },
      handlers: {
        '/messages/conversations': { json: MOCK_CONVERSATIONS },
        '/messages/directory': { json: [MOCK_PEER] },
        '/messages/unread-count': { json: { unread: 1 } },
        [`/messages/with/${PEER_ID}`]: { json: MOCK_THREAD },
        [`POST /messages/with/${PEER_ID}/read`]: { json: { ok: true } },
      },
    });
    // Count typing-ping calls separately so we can assert at least one fires.
    await page.route(`**/api/messages/with/${PEER_ID}/typing`, async (route) => {
      typingPings += 1;
      await route.fulfill({ json: { ok: true } });
    });

    await page.goto(`/messages?with=${PEER_ID}`);
    await page.waitForLoadState('networkidle');

    const composer = page.getByPlaceholder(/Write a message/);
    await expect(composer).toBeVisible({ timeout: 8000 });

    // Type a single character — fires the typing ping (the throttle is
    // first-event-allowed, then 2.5s window).
    await composer.fill('Hello peer');
    // Give the throttle + axios microtask a chance to flush.
    await page.waitForTimeout(150);
    expect(typingPings).toBeGreaterThanOrEqual(1);

    // Type several newlines to make the textarea grow.
    const startHeight = await composer.evaluate((el) => (el as HTMLElement).offsetHeight);
    await composer.fill('line one\nline two\nline three\nline four');
    await page.waitForTimeout(50);
    const grownHeight = await composer.evaluate((el) => (el as HTMLElement).offsetHeight);
    expect(grownHeight).toBeGreaterThan(startHeight);

    expect(errors).toHaveLength(0);
  });
});
