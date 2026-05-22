import { test, expect } from '@playwright/test';
import { mockApi, seedSession, trackPageErrors, MANAGER } from './_helpers';

/**
 * Regression guard for the dropdown/popover layering bug: kebab/Popover menus
 * used to render `absolute z-30` INSIDE cards, so an ancestor `overflow-hidden`
 * (calendar cards, ribbons) or a `transform` stacking context clipped them or
 * painted them behind sibling content.
 *
 * The fix portals every Popover panel to <body> with viewport-anchored fixed
 * positioning. These assertions pin that contract:
 *   1. the panel is a direct child of <body> (escapes any ancestor clip),
 *   2. it is `position: fixed` and on-screen near its trigger,
 *   3. a control inside it is actually clickable (Playwright fails if the menu
 *      is covered/clipped — i.e. if it rendered behind content).
 *
 * The Tasks toolbar "Filters" popover is the target because it renders
 * unconditionally (no data dependency) and is the exact pattern that broke.
 */
test.describe('Dropdown / popover layering', () => {
  test('Filters menu portals above content and is clickable', async ({ page }) => {
    const pageErrors = trackPageErrors(page);
    await seedSession(page, MANAGER);
    await mockApi(page, { profile: MANAGER, flags: { tasks: true } });

    await page.goto('/tasks');

    const filters = page.getByRole('button', { name: 'Filters' });
    await expect(filters).toBeVisible();
    await filters.click();

    // Panel content is visible…
    const overdue = page.getByText('Overdue only', { exact: true });
    await expect(overdue).toBeVisible();

    // …and the panel that contains it is portaled to <body>, fixed-positioned,
    // sized, and anchored on-screen near the trigger.
    const info = await overdue.evaluate((el) => {
      let node: HTMLElement | null = el as HTMLElement;
      while (node && getComputedStyle(node).position !== 'fixed') {
        node = node.parentElement;
      }
      const panel = node as HTMLElement;
      const r = panel.getBoundingClientRect();
      return {
        position: getComputedStyle(panel).position,
        parentIsBody: panel.parentElement === document.body,
        width: r.width,
        height: r.height,
        top: r.top,
        left: r.left,
        onScreen: r.top >= 0 && r.left >= 0 && r.top < window.innerHeight,
      };
    });

    expect(info.position).toBe('fixed');
    expect(info.parentIsBody).toBe(true);
    expect(info.width).toBeGreaterThan(0);
    expect(info.height).toBeGreaterThan(0);
    expect(info.onScreen).toBe(true);

    // The menu overlays content rather than hiding behind it: clicking a control
    // inside it succeeds (Playwright throws if it's covered/outside the viewport)
    // and actually toggles state.
    await overdue.click();
    await expect(page.locator('input[type="checkbox"]:checked')).toHaveCount(1);

    expect(pageErrors, `unexpected page errors: ${pageErrors.join(' | ')}`).toHaveLength(0);
  });
});
