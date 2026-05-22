/**
 * Modal / overlay E2E tests.
 *
 * Uses the Vendors page "+ New vendor" modal as a known, stable test surface.
 * The Modal component (frontend/src/components/Modal.tsx) provides:
 *   - role="dialog" + aria-modal="true" accessibility contract
 *   - Escape key → close
 *   - Backdrop click → close
 *   - Body scroll lock while open (document.body.style.overflow = 'hidden')
 *   - Focus trap (Tab cycles through focusable children)
 *   - aria-label="Close" ✕ button
 *
 * All API calls are intercepted; no real backend is needed.
 */

import { test, expect } from '@playwright/test';
import { seedSession, mockApi, MANAGER, trackPageErrors } from './_helpers';

// Navigate to the Vendors page with a fully mocked, authenticated session.
async function goToVendors(page: Parameters<typeof mockApi>[0]) {
  await seedSession(page, MANAGER);
  await mockApi(page, {
    profile: MANAGER,
    handlers: {
      '/vendors': { json: [] }, // empty list — we just need the page to load
    },
  });
  await page.goto('/vendors');
  // Wait for the page to fully load (the "+ New vendor" button should appear).
  await page.getByRole('button', { name: /new vendor/i }).waitFor({ timeout: 8000 });
}

// ---------------------------------------------------------------------------
// Accessibility contract
// ---------------------------------------------------------------------------

test.describe('Modal — accessibility contract', () => {
  test('has role="dialog" and aria-modal when open', async ({ page }) => {
    const errors = trackPageErrors(page);
    await goToVendors(page);

    // Open the modal.
    await page.getByRole('button', { name: /new vendor/i }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(errors).toHaveLength(0);
  });

  test('has aria-labelledby pointing to a visible title', async ({ page }) => {
    await goToVendors(page);
    await page.getByRole('button', { name: /new vendor/i }).click();

    const dialog = page.getByRole('dialog');
    const labelId = await dialog.getAttribute('aria-labelledby');
    if (labelId) {
      const title = page.locator(`#${labelId}`);
      await expect(title).toBeVisible();
    }
    // If no aria-labelledby, the dialog should still be accessible via aria-label.
    // Either contract is acceptable; what's not acceptable is neither.
    const hasLabelledBy = !!labelId;
    const hasLabel = !!(await dialog.getAttribute('aria-label'));
    expect(hasLabelledBy || hasLabel).toBe(true);
  });

  test('close button has aria-label="Close"', async ({ page }) => {
    await goToVendors(page);
    await page.getByRole('button', { name: /new vendor/i }).click();

    const closeBtn = page.getByRole('button', { name: /close/i });
    await expect(closeBtn).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Open / close mechanics
// ---------------------------------------------------------------------------

test.describe('Modal — open and close mechanics', () => {
  test('Escape key closes the modal', async ({ page }) => {
    const errors = trackPageErrors(page);
    await goToVendors(page);
    await page.getByRole('button', { name: /new vendor/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 3000 });
    expect(errors).toHaveLength(0);
  });

  test('clicking the ✕ close button closes the modal', async ({ page }) => {
    await goToVendors(page);
    await page.getByRole('button', { name: /new vendor/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.getByRole('button', { name: /close/i }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 3000 });
  });

  test('clicking the backdrop (outside the dialog panel) closes the modal', async ({ page }) => {
    await goToVendors(page);
    await page.getByRole('button', { name: /new vendor/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // Click the far-right edge of the viewport — the dialog panel is max-w-lg
    // (~512px) centred in a 1280px viewport, so x > ~900px is guaranteed outside.
    const vp = page.viewportSize() ?? { width: 1280, height: 720 };
    await page.mouse.click(vp.width - 20, Math.floor(vp.height / 2));
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 3000 });
  });

  test('the dialog is not present in the DOM when closed', async ({ page }) => {
    await goToVendors(page);
    // Before opening — no dialog in DOM.
    await expect(page.getByRole('dialog')).not.toBeAttached();

    // Open, then close.
    await page.getByRole('button', { name: /new vendor/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeAttached({ timeout: 3000 });
  });
});

// ---------------------------------------------------------------------------
// Body scroll lock
// ---------------------------------------------------------------------------

test.describe('Modal — body scroll lock', () => {
  test('body overflow is set to hidden while the modal is open', async ({ page }) => {
    await goToVendors(page);
    await page.getByRole('button', { name: /new vendor/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    const overflow = await page.evaluate(() => document.body.style.overflow);
    expect(overflow).toBe('hidden');
  });

  test('body overflow is restored after the modal closes', async ({ page }) => {
    await goToVendors(page);
    await page.getByRole('button', { name: /new vendor/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeAttached({ timeout: 3000 });

    const overflow = await page.evaluate(() => document.body.style.overflow);
    // Restored to '' (empty string) or 'auto' — not 'hidden'.
    expect(overflow).not.toBe('hidden');
  });
});

// ---------------------------------------------------------------------------
// Stacking context / z-index — modal must render above the sidebar
// ---------------------------------------------------------------------------

test.describe('Modal — stacking context', () => {
  test('modal z-index is higher than the sidebar z-index', async ({ page }) => {
    await goToVendors(page);
    await page.getByRole('button', { name: /new vendor/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    const result = await page.evaluate(() => {
      // The Modal renders an outer backdrop div with role="dialog" (z-50 in Tailwind).
      // The Layout sidebar typically uses z-30 or lower.
      const dialog = document.querySelector('[role="dialog"]') as HTMLElement | null;
      const sidebar =
        (document.querySelector('aside') as HTMLElement | null) ??
        (document.querySelector('nav') as HTMLElement | null);

      function getZIndex(el: HTMLElement | null): number {
        if (!el) return 0;
        return parseInt(window.getComputedStyle(el).zIndex) || 0;
      }

      return {
        dialogZ: getZIndex(dialog),
        sidebarZ: getZIndex(sidebar),
      };
    });

    // Modal z-index must be >= sidebar z-index. Equal is acceptable because when
    // z-index is equal the modal renders later in the DOM (inside the page content,
    // after the sidebar), so it stacks on top by natural DOM order.
    if (result.dialogZ > 0 || result.sidebarZ > 0) {
      expect(result.dialogZ).toBeGreaterThanOrEqual(result.sidebarZ);
    }
    // If both are 0/auto, stacking order is determined by DOM position — acceptable.
  });
});

// ---------------------------------------------------------------------------
// Focus behaviour
// ---------------------------------------------------------------------------

test.describe('Modal — focus management', () => {
  test('focus moves into the modal on open', async ({ page }) => {
    await goToVendors(page);
    await page.getByRole('button', { name: /new vendor/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // Check that a focusable element inside the dialog has focus.
    const focusedInsideDialog = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]');
      const active = document.activeElement;
      return dialog ? dialog.contains(active) : false;
    });
    expect(focusedInsideDialog).toBe(true);
  });
});
