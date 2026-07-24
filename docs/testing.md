# Testing Guide

This repo has five test layers that run at different points in the development cycle. The single entry-point gate is `npm run verify` — it runs all layers except the Playwright E2E suite and the full production build. Run it before every push.

---

## Overview

| Layer               | Command                                                      | What it covers                                                            |
| ------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------- |
| Vitest unit tests   | `npm --prefix backend test`                                  | Backend logic, ownership rules, service behavior; DB mocked               |
| TypeScript + lint   | `npm run typecheck && npm run lint`                          | Type correctness across all packages + ESLint (0 warnings allowed)        |
| Playwright E2E      | `npm --prefix frontend run test:e2e`                         | Full UI flows in Chromium against a fully mocked API                      |
| Accessibility audit | `npm --prefix frontend run test:e2e` (included in E2E suite) | axe-core WCAG scan; fails on critical/serious violations only             |
| Security ratchet    | `npm --prefix backend test` (included in Vitest suite)       | Static scan of controllers for mass-assignment and SQL-injection patterns |

---

## Layer 1 — Vitest Unit Tests

**Command**: `npm --prefix backend test`

**Single file**: `npm --prefix backend test -- src/services/permission.service.test.ts`

Backend tests use [Vitest](https://vitest.dev/) with the Postgres layer mocked at module load. Tests need no running database or `.env` file.

**Key characteristics:**

- DB is mocked via `vi.hoisted` + `vi.mock('../config/db')` — the mock factory runs before any import, so the controller imports a fake `db` without reaching the real config.
- Every test file resets mocks in `beforeEach` so cases never bleed into each other.
- Logger, AI service, and any other I/O-performing module that would reach the network are also mocked.

**Canonical examples:**

- `backend/src/services/permission.service.test.ts` — permission engine with role-tier branches, cache behavior
- `backend/src/controllers/consultants.ownership.test.ts` — ownership gate + field-allowlist (mass-assignment guard)
- `backend/src/roles.test.ts` — role hierarchy constants
- `backend/src/security/patterns.test.ts` — security ratchet (see Layer 5)

### Adding a new backend test

1. Create `backend/src/[controllers|services]/<name>.test.ts`.
2. Use the `vi.hoisted` + `vi.mock` pattern to stub the DB before importing the module under test:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

// 1. vi.hoisted runs before imports — define mutable fixture state here.
const mock = vi.hoisted(() => {
  const rows: Record<string, unknown[]> = {};
  const updates: { table: string; payload: Record<string, unknown> }[] = [];
  return { rows, updates };
});

// 2. Mock config/db before the controller is imported.
vi.mock('../config/db', () => {
  function makeBuilder(table: string) {
    const b: Record<string, unknown> = {};
    Object.assign(b, {
      select: () => b,
      eq: () => b,
      order: () => b,
      limit: () => b,
      update(payload: Record<string, unknown>) {
        mock.updates.push({ table, payload });
        return b;
      },
      insert(payload: Record<string, unknown>) {
        mock.updates.push({ table: `insert:${table}`, payload });
        return b;
      },
      maybeSingle: () =>
        Promise.resolve({ data: (mock.rows[table] ?? [])[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: mock.rows[table] ?? [], error: null }).then(resolve),
    });
    return b;
  }
  return { db: { from: (t: string) => makeBuilder(t) }, pool: {} };
});

vi.mock('../config/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// 3. Import the module under test AFTER the mocks.
import * as myController from './my.controller';

// 4. Reset mock state before each test.
beforeEach(() => {
  for (const k of Object.keys(mock.rows)) delete mock.rows[k];
  mock.updates.length = 0;
});

describe('my controller', () => {
  it('does the thing', async () => {
    mock.rows.my_table = [{ id: '1', name: 'test' }];
    // ... call the handler, assert on mock.updates or the response
  });
});
```

3. Build a minimal `mkRes()` helper (status + json capture) and a `call(handler, user, opts)` wrapper — see `consultants.ownership.test.ts` for the full pattern.
4. Keep assertions focused: ownership checks (who can read/write), field-allowlist checks (what fields make it into the DB update), and error-status codes.

---

## Layer 2 — TypeScript + Lint

**Commands**:

```bash
npm run typecheck   # shared:build → backend tsc --noEmit → frontend tsc --noEmit
npm run lint        # eslint --max-warnings 0 in backend + frontend
```

Both run as part of `npm run verify`. They must both pass before any merge.

**Notes:**

- `npm run typecheck` rebuilds the `shared` package first. If you edited `shared/src/**`, it picks up your changes automatically.
- ESLint is configured with `--max-warnings 0` — every warning is a failure.
- Prettier formatting is checked separately via `npm run format:check` (also in `verify`). The pre-commit hook (lint-staged) auto-formats staged files; the CI gate only checks, not fixes.

---

## Layer 3 — Playwright E2E Tests

**Command**: `npm --prefix frontend run test:e2e`

**One-time setup** (download Chromium): `npx --prefix frontend playwright install chromium`

E2E specs live in `frontend/e2e/`. They run against the real Vite-built app with every API call intercepted — no backend or database needed.

**Canonical examples:**

- `frontend/e2e/task-flows.spec.ts` — task list rendering, RBAC gate on the "New Task" button, modal open/close
- `frontend/e2e/a11y-contrast.spec.ts` — accessibility audit across key pages

### `mockApi` and `seedSession`

Both helpers are exported from `frontend/e2e/_helpers.ts`.

**`seedSession(page, profile)`** — seeds a valid session into `localStorage` before the app boots. Without it, `AuthContext` sees no token and redirects to `/login`.

**`mockApi(page, opts)`** — installs a `page.route('**/api/**', ...)` interceptor that routes requests to canned responses. The intercept map covers `GET /auth/me`, `GET /feature-flags/me`, the SSE stream, and token refresh. Anything not explicitly handled falls back to `[]` (GET) or `{}` (mutations) so incidental fetches don't hang.

### Adding a new E2E spec

1. Create `frontend/e2e/<feature>.spec.ts`.
2. Import from `_helpers`:

```ts
import { test, expect } from '@playwright/test';
import { seedSession, mockApi, MANAGER, CONSULTANT, trackPageErrors } from './_helpers';

test.describe('My feature', () => {
  test('renders correctly for a manager', async ({ page }) => {
    // Optional: track uncaught JS exceptions.
    const errors = trackPageErrors(page);

    // Seed localStorage before navigation so the app boots authenticated.
    await seedSession(page, MANAGER);

    // Install the API interceptor with per-endpoint response overrides.
    await mockApi(page, {
      profile: MANAGER,
      flags: { my_feature: true },
      handlers: {
        '/my-endpoint': { json: [{ id: '1', name: 'Widget' }] },
        'POST /my-endpoint': { status: 201, json: { id: '2' } },
      },
    });

    await page.goto('/my-feature');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('Widget')).toBeVisible({ timeout: 8000 });
    expect(errors).toHaveLength(0);
  });
});
```

3. Use `MANAGER`, `CONSULTANT`, and `RECRUITER` profile fixtures from `_helpers.ts` for the standard roles, or define a custom `MockProfile` inline.
4. Handler keys are `"<METHOD> <path>"` or just `"<path>"` (path is relative to `/api`, e.g. `/tasks`).
5. Save screenshots for visual review: `await page.screenshot({ path: 'e2e-results/<name>.png' })`.

---

## Layer 4 — Accessibility Audit

**Command**: `npm --prefix frontend run test:e2e` (the a11y spec runs as part of the E2E suite)

**Spec**: `frontend/e2e/a11y-contrast.spec.ts`

Uses `@axe-core/playwright` to run a WCAG 2.x audit on four pages: `/dashboard`, `/tasks`, `/messages`, `/consultants`. All API calls are mocked via the same `mockApi` helper.

**Pass/fail policy**: Only `critical` and `serious` axe violations block the suite. `moderate` and `minor` violations are logged to the console but do not fail the test. The intent is to keep the bar high enough to catch real regressions without blocking on lower-severity issues that require design changes.

**Screenshots** of each audited page are saved to `e2e-results/a11y-<page>.png` regardless of pass/fail, for visual review.

When adding a new page to the audit:

```ts
const PAGES: { name: string; path: string }[] = [
  // ... existing pages
  { name: 'my-page', path: '/my-page' },
];
```

The parameterized `for` loop in the spec generates one test per entry automatically.

---

## Layer 5 — Security Patterns Ratchet

**Command**: `npm --prefix backend test` (the ratchet runs as part of the Vitest suite)

**Spec**: `backend/src/security/patterns.test.ts`

A static scan of every file in `backend/src/controllers/` that fails the build when a new security-sensitive pattern appears. It is a ratchet: known pre-existing offenders are recorded in a baseline; the baseline can only go down, never up.

**Patterns checked:**

| Pattern                                                                                             | What it catches                                                          |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `.update(req.body)` / `.insert(req.body)` / `.insert({ ...req.body })` / `.update({ ...req.body })` | Mass-assignment — body passed directly to the DB without a Zod allowlist |
| `.ilike('email', ...)`                                                                              | Email wildcard injection — must use `.eq('email', email.toLowerCase())`  |
| `pool.query('...' + variable)`                                                                      | Raw SQL string concatenation — use `$1` placeholders                     |
| `httpError(403, ...)` in ownership helpers                                                          | Existence oracle leak — ownership failures must throw 404, not 403       |

**The baseline is currently empty** (`MASS_ASSIGNMENT_BASELINE: {}`, `EMAIL_ILIKE_BASELINE: {}`, `RAW_SQL_CONCAT_BASELINE: {}`). Any new violation is an immediate build failure; there is no allowance to baseline it in.

**When you fix a flagged controller:**

1. Gate the body with a `.strict()` Zod schema (see `applications.controller.ts updateSchema` for the pattern).
2. Lower the baseline entry to the new count (or remove it if 0).
3. The test will tell you the current count if you get it wrong.

---

## `npm run verify` vs `npm run verify:full`

```bash
npm run verify      # format:check → typecheck → lint → backend vitest
npm run verify:full # verify → full build (shared + backend + frontend) → Playwright E2E
```

**`npm run verify`** is the standard pre-push gate. It runs entirely in memory (no file output, no browser), completes in under a minute on a warm machine, and is what CI runs on every PR.

**`npm run verify:full`** additionally:

- Runs `npm run build` (compiles all three packages to their output formats — confirms the production build is not broken).
- Runs the full Playwright E2E + accessibility suite in Chromium (requires `playwright install chromium`).

Run `verify:full` before promoting to `main` or after changes that touch the Vite build config, `App.tsx` routing, or shared CSS tokens.

---

## CI Gates Summary

| Gate       | Command                              | Blocks on                                                          | Allows                                                  |
| ---------- | ------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------- |
| Formatting | `npm run format:check`               | Any file not matching Prettier config                              | Auto-fixed by pre-commit lint-staged hook               |
| TypeScript | `npm run typecheck`                  | Type errors in `backend/` or `frontend/` (shared is rebuilt first) | Warnings — there are none by convention                 |
| Lint       | `npm run lint`                       | Any ESLint error or warning (`--max-warnings 0`)                   | —                                                       |
| Unit tests | `npm --prefix backend test`          | Vitest test failures, including the security ratchet               | Tests that only exercise mocked DB (no Postgres needed) |
| E2E + a11y | `npm --prefix frontend run test:e2e` | Playwright test failures; critical/serious axe violations          | `moderate`/`minor` axe violations                       |
| Build      | `npm run build`                      | TypeScript compile errors in output mode; Vite build errors        | —                                                       |

The pre-commit hook (Husky + lint-staged) runs Prettier on every staged file. The commit-msg hook warns on non-Conventional Commit messages; set `HIREORBITAI_STRICT_COMMITS=1` to make it a hard failure.
