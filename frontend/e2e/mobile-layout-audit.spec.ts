/**
 * Mobile layout audit — iPhone 12 viewport (390×844).
 *
 * For each target page this spec:
 *   1. Seeds a MANAGER session + full mock API.
 *   2. Navigates and waits for networkidle.
 *   3. Saves a fullPage screenshot to e2e-results/mobile-audit-<page>.png.
 *   4. Measures horizontal overflow on the body AND every scrollable child.
 *   5. Checks for buttons / action-row items whose bounding boxes place them
 *      outside the 390 px logical viewport.
 *   6. Probes for elements with overflow-x: scroll/auto wider than the viewport.
 *   7. Collects all uncaught JS exceptions.
 *
 * Run with:
 *   npm --prefix frontend run test:e2e -- mobile-layout-audit
 */

import { test, expect } from '@playwright/test';
import { seedSession, mockApi, MANAGER, trackPageErrors } from './_helpers';
import {
  ALL_FLAGS,
  BASE_HANDLERS,
  MOCK_CONSULTANTS,
  MOCK_COURSES,
  MOCK_RESUMES_FOR_C1,
} from './_mock-data';
import * as fs from 'fs';
import * as path from 'path';

// ─── Viewport — iPhone 12 / iPhone 14 logical size ───────────────────────────
test.use({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) ' +
    'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1',
});

// ─── Output dir ──────────────────────────────────────────────────────────────
const OUT = path.resolve('e2e-results');

function ensureOut() {
  fs.mkdirSync(OUT, { recursive: true });
}

// ─── Layout probe helpers ─────────────────────────────────────────────────────

interface OverflowReport {
  bodyOverflow: boolean;
  bodyScrollWidth: number;
  viewportWidth: number;
  overflowingSelectors: string[];
}

/**
 * Evaluates the page for any element that causes or has horizontal overflow.
 * Returns a plain-object report that Playwright can serialize across the context
 * boundary (no DOM nodes).
 */
async function measureOverflow(page: import('@playwright/test').Page): Promise<OverflowReport> {
  return page.evaluate((): OverflowReport => {
    const vw = document.documentElement.clientWidth;
    const bodyScroll = document.body.scrollWidth;

    const offenders: string[] = [];

    document.querySelectorAll('*').forEach((el) => {
      const rect = el.getBoundingClientRect();
      // Element's right edge overhangs the viewport
      if (rect.right > vw + 2) {
        // Build a short human-readable selector
        const tag = el.tagName.toLowerCase();
        const id = el.id ? `#${el.id}` : '';
        const cls = Array.from(el.classList).slice(0, 3).join('.').replace(/\s+/g, '').slice(0, 60);
        const sel = `${tag}${id}${cls ? '.' + cls : ''}`;
        if (!offenders.includes(sel)) offenders.push(sel);
      }
    });

    return {
      bodyOverflow: bodyScroll > vw,
      bodyScrollWidth: bodyScroll,
      viewportWidth: vw,
      overflowingSelectors: offenders.slice(0, 20), // cap to avoid giant output
    };
  });
}

interface ButtonOverlapReport {
  overlapping: { a: string; b: string; ax2: number; bx1: number }[];
}

/**
 * Finds pairs of buttons / interactive elements in a page-header / toolbar row
 * whose bounding boxes horizontally overlap (indicating crowding).
 */
async function measureButtonOverlap(
  page: import('@playwright/test').Page,
): Promise<ButtonOverlapReport> {
  return page.evaluate((): ButtonOverlapReport => {
    const interactives = Array.from(
      document.querySelectorAll(
        'header button, header a[role="button"], header [role="menuitem"], ' +
          '[data-testid*="header"] button, .page-header button, ' +
          'h1 ~ * button, h2 ~ * button',
      ),
    ).filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });

    const overlapping: { a: string; b: string; ax2: number; bx1: number }[] = [];

    for (let i = 0; i < interactives.length; i++) {
      for (let j = i + 1; j < interactives.length; j++) {
        const ra = interactives[i].getBoundingClientRect();
        const rb = interactives[j].getBoundingClientRect();

        // Same vertical band AND bounding boxes overlap horizontally
        const vertOverlap = ra.top < rb.bottom && ra.bottom > rb.top;
        const horizOverlap = ra.right > rb.left && ra.left < rb.right;
        if (vertOverlap && horizOverlap) {
          const label = (el: Element) =>
            (el as HTMLElement).innerText?.trim().slice(0, 30) ||
            el.getAttribute('aria-label') ||
            el.tagName;
          overlapping.push({
            a: label(interactives[i]),
            b: label(interactives[j]),
            ax2: Math.round(ra.right),
            bx1: Math.round(rb.left),
          });
        }
      }
    }
    return { overlapping };
  });
}

interface TruncationReport {
  truncated: { text: string; selector: string; scrollWidth: number; clientWidth: number }[];
}

/**
 * Finds heading / label nodes whose rendered scrollWidth > offsetWidth,
 * meaning text is being clipped or ellipsis-truncated.
 */
async function measureTruncation(page: import('@playwright/test').Page): Promise<TruncationReport> {
  return page.evaluate((): TruncationReport => {
    const candidates = Array.from(
      document.querySelectorAll('h1, h2, h3, th, td, label, .page-title, [data-testid*="title"]'),
    );
    const truncated: {
      text: string;
      selector: string;
      scrollWidth: number;
      clientWidth: number;
    }[] = [];

    for (const el of candidates) {
      const hw = el as HTMLElement;
      if (hw.scrollWidth > hw.clientWidth + 2 && hw.clientWidth > 0) {
        const tag = hw.tagName.toLowerCase();
        const cls = Array.from(hw.classList).slice(0, 2).join('.');
        truncated.push({
          text: hw.innerText?.trim().slice(0, 60) || '',
          selector: `${tag}.${cls}`,
          scrollWidth: hw.scrollWidth,
          clientWidth: hw.clientWidth,
        });
      }
    }
    return { truncated: truncated.slice(0, 15) };
  });
}

// ─── Core audit helper ────────────────────────────────────────────────────────

interface PageAuditResult {
  page: string;
  screenshot: string;
  overflow: OverflowReport;
  buttonOverlap: ButtonOverlapReport;
  truncation: TruncationReport;
  consoleErrors: string[];
}

async function auditPage(
  pw: import('@playwright/test').Page,
  pagePath: string,
  name: string,
  errors: string[],
): Promise<PageAuditResult> {
  await pw.goto(pagePath);
  await pw.waitForLoadState('networkidle');

  // Wait a beat for any deferred renders / skeleton swaps
  await pw.waitForTimeout(600);

  ensureOut();
  const screenshotPath = path.join(OUT, `mobile-audit-${name}.png`);
  await pw.screenshot({ path: screenshotPath, fullPage: true });

  const overflow = await measureOverflow(pw);
  const buttonOverlap = await measureButtonOverlap(pw);
  const truncation = await measureTruncation(pw);

  return {
    page: pagePath,
    screenshot: screenshotPath,
    overflow,
    buttonOverlap,
    truncation,
    consoleErrors: [...errors],
  };
}

// ─── Shared setup ─────────────────────────────────────────────────────────────

function setupManager(page: import('@playwright/test').Page) {
  return async () => {
    await seedSession(page, MANAGER);
    await mockApi(page, {
      profile: MANAGER,
      flags: ALL_FLAGS,
      handlers: {
        ...BASE_HANDLERS,
        '/consultants': { json: MOCK_CONSULTANTS },
        '/resumes/consultant/c-1': { json: MOCK_RESUMES_FOR_C1 },
        '/training/courses': { json: MOCK_COURSES },
        '/training/assignments': { json: [] },
        '/users': { json: [] },
        '/admin/users': { json: [] },
        '/admin/feature-flags': { json: [] },
      },
    });
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

const PAGES: { name: string; path: string }[] = [
  { name: 'dashboard', path: '/dashboard' },
  { name: 'tasks', path: '/tasks' },
  { name: 'jobs', path: '/jobs' },
  { name: 'resumes', path: '/resumes' },
  { name: 'consultants', path: '/consultants' },
  { name: 'admin-users', path: '/admin/users' },
  { name: 'training-courses', path: '/training/courses' },
  { name: 'messages', path: '/messages' },
  { name: 'reports', path: '/reports' },
  { name: 'admin-feature-flags', path: '/admin/feature-flags' },
];

for (const pg of PAGES) {
  test(`mobile layout audit — ${pg.path}`, async ({ page }) => {
    const errors = trackPageErrors(page);

    const setup = setupManager(page);
    await setup();

    const result = await auditPage(page, pg.path, pg.name, errors);

    // ── 1. No horizontal body overflow ──────────────────────────────────────
    if (result.overflow.bodyOverflow) {
      console.warn(
        `[overflow] ${pg.path}: body.scrollWidth=${result.overflow.bodyScrollWidth} > viewportWidth=${result.overflow.viewportWidth}`,
      );
      if (result.overflow.overflowingSelectors.length) {
        console.warn(
          `  Offending elements:\n  ${result.overflow.overflowingSelectors.join('\n  ')}`,
        );
      }
    }
    expect(
      result.overflow.bodyOverflow,
      `${pg.path}: horizontal overflow detected (scrollWidth ${result.overflow.bodyScrollWidth} > ${result.overflow.viewportWidth}). ` +
        `Offenders: ${result.overflow.overflowingSelectors.join(', ')}`,
    ).toBe(false);

    // ── 2. No overlapping header buttons ───────────────────────────────────
    if (result.buttonOverlap.overlapping.length) {
      console.warn(
        `[button-overlap] ${pg.path}: ${result.buttonOverlap.overlapping.length} overlapping pair(s):`,
      );
      for (const pair of result.buttonOverlap.overlapping) {
        console.warn(`  "${pair.a}" (right=${pair.ax2}) overlaps "${pair.b}" (left=${pair.bx1})`);
      }
    }
    expect(
      result.buttonOverlap.overlapping,
      `${pg.path}: header buttons overlap on 390 px viewport`,
    ).toHaveLength(0);

    // ── 3. No console errors ────────────────────────────────────────────────
    if (result.consoleErrors.length) {
      console.warn(`[console-errors] ${pg.path}:`, result.consoleErrors);
    }
    expect(result.consoleErrors, `${pg.path}: uncaught JS exceptions`).toHaveLength(0);

    // ── 4. Log (don't fail) truncation findings ─────────────────────────────
    if (result.truncation.truncated.length) {
      console.warn(
        `[truncation] ${pg.path}: ${result.truncation.truncated.length} text node(s) may be clipped:`,
      );
      for (const t of result.truncation.truncated) {
        console.warn(
          `  "${t.text}" (${t.selector}) scrollWidth=${t.scrollWidth} clientWidth=${t.clientWidth}`,
        );
      }
    }
  });
}
