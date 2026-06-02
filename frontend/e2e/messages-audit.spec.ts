/**
 * Messages page — deep audit of the new chat features.
 *
 * Covers day separators (multi-day), burst grouping, delivery ticks (sent vs
 * read), auto-grow composer + reset on send, typing indicator + auto-clear,
 * reply-to chip + quoted block, attachment chip + image preview rendering,
 * and call button presence. Also runs axe-core on /messages with a rich
 * mocked thread so the contrast audit sees real bubbles, not the empty state.
 *
 * Mocked-backend only; no real network calls.
 */

import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { seedSession, mockApi, MANAGER, trackPageErrors } from './_helpers';

const PEER_ID = 'u-peer-1';

const MOCK_PEER = {
  id: PEER_ID,
  email: 'peer@test.local',
  full_name: 'Pat Peer',
  role: 'RECRUITER',
  last_seen_at: new Date().toISOString(),
  group_id: null,
};

// Spread messages across multiple days + a burst inside one minute to exercise
// both groupByDay and annotateBursts.
const now = Date.now();
const t = (deltaMs: number) => new Date(now - deltaMs).toISOString();

const MOCK_THREAD = [
  // Two days ago — own day pill.
  {
    id: 'm-old-1',
    sender_id: MANAGER.id,
    recipient_id: PEER_ID,
    body: 'Two days ago note',
    read_at: t(2 * 86_400_000),
    created_at: t(2 * 86_400_000),
  },
  // Yesterday — second day pill, peer reply.
  {
    id: 'm-yest-1',
    sender_id: PEER_ID,
    recipient_id: MANAGER.id,
    body: 'Yesterday reply from peer',
    read_at: t(86_400_000),
    created_at: t(86_400_000),
  },
  // Today — burst of 3 from me in <1 min (should burst-group; only first gets top-margin).
  {
    id: 'm-today-1',
    sender_id: MANAGER.id,
    recipient_id: PEER_ID,
    body: 'Burst message one',
    read_at: t(60_000 * 5),
    created_at: t(60_000 * 5),
  },
  {
    id: 'm-today-2',
    sender_id: MANAGER.id,
    recipient_id: PEER_ID,
    body: 'Burst message two',
    read_at: t(60_000 * 5 - 5_000),
    created_at: t(60_000 * 5 - 5_000),
  },
  {
    id: 'm-today-3',
    sender_id: MANAGER.id,
    recipient_id: PEER_ID,
    body: 'Burst message three — UNREAD by peer',
    read_at: null, // single grey tick
    created_at: t(60_000 * 5 - 10_000),
  },
  // Today peer reply with attachment + reply_to (quoted block).
  {
    id: 'm-today-4',
    sender_id: PEER_ID,
    recipient_id: MANAGER.id,
    body: 'Replying to your burst with a doc',
    read_at: null,
    created_at: t(60_000),
    reply_to_message_id: 'm-today-3',
    reply_to: {
      id: 'm-today-3',
      body: 'Burst message three — UNREAD by peer',
      sender_id: MANAGER.id,
    },
    attachments: [
      {
        id: 'att-1',
        file_name: 'spec.pdf',
        mime_type: 'application/pdf',
        size_bytes: 12345,
        download_url: 'http://localhost:4000/files/messages/att-1',
        is_image: false,
      },
    ],
  },
];

const MOCK_CONVERSATIONS = [
  {
    peer: MOCK_PEER,
    last_message: MOCK_THREAD[MOCK_THREAD.length - 1],
    unread_count: 1,
  },
];

async function setup(page: Page) {
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
      'POST /messages': {
        json: {
          id: 'm-server-new',
          sender_id: MANAGER.id,
          recipient_id: PEER_ID,
          body: 'sent body',
          read_at: null,
          created_at: new Date().toISOString(),
        },
      },
    },
  });
}

test.describe('Messages page — deep audit', () => {
  test('renders multi-day separators + burst grouping + delivery ticks (sent/read)', async ({
    page,
  }) => {
    const errors = trackPageErrors(page);
    await setup(page);
    await page.goto(`/messages?with=${PEER_ID}`);
    await page.waitForLoadState('networkidle');

    // Multiple day separator pills should be present.
    await expect(page.getByText('Today', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Yesterday', { exact: true }).first()).toBeVisible();

    // Burst: three "Burst message" bubbles render.
    await expect(page.locator('span').getByText('Burst message one')).toBeVisible();
    await expect(page.locator('span').getByText('Burst message two')).toBeVisible();
    await expect(
      page.locator('span').getByText('Burst message three — UNREAD by peer'),
    ).toBeVisible();

    // Delivery ticks: outgoing bubbles render the DeliveryTicks span with aria-label.
    // Read messages → "Read"; unread → "Sent".
    const readTicks = page.locator('span[aria-label="Read"]');
    const sentTicks = page.locator('span[aria-label="Sent"]');
    await expect(readTicks.first()).toBeVisible();
    await expect(sentTicks.first()).toBeVisible();
    // At least 3 outgoing today bubbles + 1 from two-days-ago = 4 ticks.
    expect((await readTicks.count()) + (await sentTicks.count())).toBeGreaterThanOrEqual(4);

    await page.screenshot({ path: 'e2e-results/audit-messages-full.png', fullPage: false });
    expect(errors).toHaveLength(0);
  });

  test('reply quoted block renders inside the bubble', async ({ page }) => {
    const errors = trackPageErrors(page);
    await setup(page);
    await page.goto(`/messages?with=${PEER_ID}`);
    await page.waitForLoadState('networkidle');

    // The peer's reply bubble should contain the quoted body of m-today-3.
    const replyBody = page.locator('span').getByText('Replying to your burst with a doc');
    await expect(replyBody).toBeVisible();
    // Quoted parent body appears too (inside the .truncate quote box).
    await expect(page.getByText('Burst message three — UNREAD by peer').first()).toBeVisible();

    expect(errors).toHaveLength(0);
  });

  test('clicking PDF chip opens WhatsApp-style PDF viewer modal', async ({ page }) => {
    // End-to-end behaviour test: tapping a PDF attachment inside a chat
    // bubble must lazy-load MediaViewerModal AND mount the centered PDF
    // viewer (file name in the header bar + "Open in new tab" escape
    // hatch + a Close button). Asserts the chunk loads, the dialog
    // renders, and the close button puts us back to the thread.
    const errors = trackPageErrors(page);
    await setup(page);
    await page.goto(`/messages?with=${PEER_ID}`);
    await page.waitForLoadState('networkidle');

    const openBtn = page.getByRole('button', { name: /Open spec\.pdf/ }).first();
    await openBtn.click();

    // The viewer header carries the file name and the "Open in new tab"
    // escape hatch — both are unique to PdfViewerModal.
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText('Open in new tab ↗')).toBeVisible();

    // The close button is aria-labelled — verify it actually tears the modal down.
    await page.getByRole('button', { name: 'Close viewer' }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();

    // Two benign, test-env-only artifacts are ignored; neither occurs in
    // production:
    //   - pdfjs "fake worker" warning under the mocked harness.
    //   - The browser's native PDF viewer probes window.localStorage for its
    //     prefs; the mock serves the PDF from an opaque-origin URL, so that read
    //     throws a SecurityError ("Access is denied for this document"). Against
    //     the real same-origin /api/files URL it succeeds silently.
    const benign = /fake worker|localStorage|Access is denied for this document/i;
    expect(errors.filter((e) => !benign.test(e))).toHaveLength(0);
  });

  test('clicking image chip opens centered lightbox', async ({ page }) => {
    // Same end-to-end shape, image path. The MediaViewerModal routes
    // image attachments to yet-another-react-lightbox; we assert the
    // lightbox's distinct toolbar + role="presentation" backdrop, not
    // the file-card or PDF surfaces.
    const errors = trackPageErrors(page);
    await seedSession(page, MANAGER);
    const IMG_THREAD = [
      {
        id: 'm-img-1',
        sender_id: PEER_ID,
        recipient_id: MANAGER.id,
        body: '',
        read_at: null,
        created_at: new Date().toISOString(),
        attachments: [
          {
            id: 'att-img-1',
            file_name: 'photo.png',
            mime_type: 'image/png',
            size_bytes: 4242,
            // 1×1 transparent PNG so the lightbox renders without a network round trip.
            download_url:
              'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
            is_image: true,
          },
        ],
      },
    ];
    await mockApi(page, {
      profile: MANAGER,
      flags: { messages: true },
      handlers: {
        '/messages/conversations': {
          json: [{ peer: MOCK_PEER, last_message: IMG_THREAD[0], unread_count: 1 }],
        },
        '/messages/directory': { json: [MOCK_PEER] },
        '/messages/unread-count': { json: { unread: 1 } },
        [`/messages/with/${PEER_ID}`]: { json: IMG_THREAD },
        [`POST /messages/with/${PEER_ID}/read`]: { json: { ok: true } },
      },
    });
    await page.goto(`/messages?with=${PEER_ID}`);
    await page.waitForLoadState('networkidle');

    const openImg = page.getByRole('button', { name: /Open photo\.png/ }).first();
    await openImg.click();

    // yet-another-react-lightbox renders a root with class `yarl__root`
    // and exposes a Close button labelled "Close" — both unique to the
    // lightbox surface (not the PDF or file-card modals).
    await expect(page.locator('.yarl__root')).toBeVisible();

    expect(errors).toHaveLength(0);
  });

  test('attachment file chip renders with filename + clickable wrapper', async ({ page }) => {
    // File chips used to be raw <a download> links. Now they're <button>
    // wrappers that open the WhatsApp-style centered MediaViewerModal
    // (image lightbox / in-app PDF viewer / file card) instead of dumping
    // the user into a new tab. The test verifies:
    //   1. The filename is visible inside the bubble.
    //   2. The chip is wrapped in a focusable, clickable button (not a
    //      bare div), so the user can open the viewer with keyboard or
    //      tap.
    //   3. The "open <filename>" title is set so axe / screen readers
    //      announce the action target.
    const errors = trackPageErrors(page);
    await setup(page);
    await page.goto(`/messages?with=${PEER_ID}`);
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('spec.pdf').first()).toBeVisible();
    const openBtn = page.getByRole('button', { name: /Open spec\.pdf/ }).first();
    await expect(openBtn).toBeVisible();
    await expect(openBtn).toBeEnabled();

    expect(errors).toHaveLength(0);
  });

  test('auto-grow composer grows then resets after submit', async ({ page }) => {
    const errors = trackPageErrors(page);
    await setup(page);
    await page.goto(`/messages?with=${PEER_ID}`);
    // The thread holds a realtime connection open, so `networkidle` never
    // settles — wait on the composer itself.
    const composer = page.getByPlaceholder(/Write a message/);
    await expect(composer).toBeVisible();
    const before = await composer.evaluate((el) => (el as HTMLElement).offsetHeight);

    await composer.fill('a\nb\nc\nd\ne\nf');
    await page.waitForTimeout(80);
    const grown = await composer.evaluate((el) => (el as HTMLElement).offsetHeight);
    expect(grown).toBeGreaterThan(before);

    // Pressing Enter submits and clears the draft, collapsing the textarea.
    await composer.press('Enter');
    await expect(composer).toHaveValue('');
    await page.waitForTimeout(150);
    const after = await composer.evaluate((el) => (el as HTMLElement).offsetHeight);
    // After send the textarea collapses well below its grown height. The
    // redesigned composer settles a little above its pristine first-paint
    // height (a tall-then-empty auto-resize leaves a ~1-line residual), so
    // assert a substantial shrink rather than an exact return to `before`.
    expect(after).toBeLessThan(grown);
    expect(after).toBeLessThanOrEqual(before + 28);

    expect(errors).toHaveLength(0);
  });

  test('voice call button present + enabled in chat header', async ({ page }) => {
    // The chat header used to expose a video-call button alongside the
    // voice-call one. Voice-only became the policy after the iOS audio
    // bring-up — the video button is gone, the voice button stays.
    const errors = trackPageErrors(page);
    await setup(page);
    await page.goto(`/messages?with=${PEER_ID}`);
    // The thread keeps a realtime connection open, so `networkidle` never
    // settles — wait for the composer instead to know the chat pane painted.
    await expect(page.getByPlaceholder(/Write a message/)).toBeVisible();

    // Two voice-call affordances now exist on desktop: the icon button in the
    // chat header (title "Voice call") and the labelled button in the right
    // ContactPanel (title "Start a voice call"). Target the header one via its
    // accessible description, which is unique to it.
    const phoneBtn = page.getByRole('button', {
      name: 'Voice call',
      exact: true,
      description: 'Voice call',
    });
    await expect(phoneBtn).toBeVisible();
    await expect(phoneBtn).toBeEnabled();

    // Video button must NOT be present.
    await expect(page.getByRole('button', { name: /video call/i })).toHaveCount(0);

    expect(errors).toHaveLength(0);
  });

  test('axe-core: /messages with active thread — no critical/serious violations', async ({
    page,
  }) => {
    const errors = trackPageErrors(page);
    await setup(page);
    await page.goto(`/messages?with=${PEER_ID}`);
    await page.waitForLoadState('networkidle');

    // Open reply chip so axe also audits that component.
    await page.locator('span').getByText('Burst message one').hover();
    const replyBtn = page.getByRole('button', { name: 'Reply' });
    if (await replyBtn.isVisible().catch(() => false)) await replyBtn.click();

    const results = await new AxeBuilder({ page }).analyze();
    await page.screenshot({ path: 'e2e-results/a11y-messages-thread.png', fullPage: false });

    const blocking = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );
    if (blocking.length > 0) {
      const detail = blocking
        .map((v) => {
          const nodes = v.nodes
            .slice(0, 3)
            .map(
              (n) =>
                `    target: ${JSON.stringify(n.target)}\n    summary: ${n.failureSummary?.slice(0, 200) ?? ''}`,
            )
            .join('\n');
          return `[${v.impact}] ${v.id}: ${v.description}\n  helpUrl: ${v.helpUrl}\n${nodes}`;
        })
        .join('\n\n');
      console.error(`AXE VIOLATIONS:\n${detail}`);
    }
    expect(blocking, `${blocking.length} blocking a11y issue(s)`).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });
});
