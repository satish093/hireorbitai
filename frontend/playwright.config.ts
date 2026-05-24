import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the HireOrbit AI frontend smoke suite.
 *
 * These are **mocked-backend** tests: Playwright auto-starts only the Vite dev
 * server and every spec intercepts `**​/api/**` with canned JSON via
 * `page.route` (see e2e/_helpers.ts). There is NO real backend and NO Postgres
 * dependency, so the suite runs identically on a Windows dev box and in CI.
 *
 * The dev server needs `VITE_API_URL` at module load (frontend/src/config/env.ts
 * throws without it). We inject a dummy-but-valid URL below; since all calls are
 * intercepted, the host never has to exist.
 */
const API_ORIGIN = 'http://localhost:4000';

export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e-results',
  // Fail the build on CI if test.only was committed.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Single worker keeps the shared dev server happy and output deterministic.
  workers: 1,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 60_000,
  expect: { timeout: 7_500 },
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    // No real network should ever be hit; surface it loudly if a test forgets
    // to mock an endpoint by failing fast rather than hanging on a real host.
    actionTimeout: 10_000,
    screenshot: 'only-on-failure',
    video: 'off',
    // Disable CSS animations/transitions so axe contrast audits see final colours,
    // not mid-fade opacity blends (animate-fade-in-up starts from opacity:0).
    reducedMotion: 'reduce',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      // Exposed to the app as import.meta.env.VITE_API_URL (Vite forwards
      // VITE_-prefixed process.env vars). Intercepted, never actually reached.
      VITE_API_URL: `${API_ORIGIN}/api`,
    },
  },
});
