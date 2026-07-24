/**
 * Behavioural tests for the org-wide monthly call-duration budget.
 *
 * Pins:
 *   - Under cap → resolves; SQL query ran.
 *   - At cap → throws 503 with the maintenance-style message.
 *   - 60 s TTL cache → repeat calls don't re-query Postgres.
 *   - invalidateMonthlyHoursUsed() forces the next call to re-query.
 *   - Calendar-month rollover auto-invalidates (cache key is YYYY-MM).
 *   - CALLS_MONTHLY_HOUR_CAP=0 disables the cap entirely (escape hatch).
 *   - Cap message includes used+cap metadata for incident triage.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  poolQueryCalls: 0,
  hoursToReturn: 0,
  envCap: 980,
}));

vi.mock('../config/db', () => ({
  pool: {
    query: vi.fn(async () => {
      mock.poolQueryCalls++;
      return { rows: [{ hours: mock.hoursToReturn }] };
    }),
  },
}));

vi.mock('../config/env', () => ({
  get env() {
    return { calls: { monthlyHourCap: mock.envCap } };
  },
}));

vi.mock('../config/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Import AFTER mocks. Re-imported in beforeEach via vi.resetModules so the
// in-module cache state starts fresh for each test.
let svc: typeof import('./callsBudget.service');

beforeEach(async () => {
  mock.poolQueryCalls = 0;
  mock.hoursToReturn = 0;
  mock.envCap = 980;
  vi.resetModules();
  svc = await import('./callsBudget.service');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('getMonthlyHoursUsed', () => {
  it('returns 0 for an empty month', async () => {
    mock.hoursToReturn = 0;
    expect(await svc.getMonthlyHoursUsed()).toBe(0);
    expect(mock.poolQueryCalls).toBe(1);
  });

  it('coerces the SQL result to a Number', async () => {
    mock.hoursToReturn = 42.5;
    expect(await svc.getMonthlyHoursUsed()).toBe(42.5);
  });

  it('memoizes for the cache TTL — back-to-back calls run ONE query', async () => {
    mock.hoursToReturn = 100;
    await svc.getMonthlyHoursUsed();
    await svc.getMonthlyHoursUsed();
    await svc.getMonthlyHoursUsed();
    expect(mock.poolQueryCalls).toBe(1);
  });

  it('refetches after invalidateMonthlyHoursUsed() so /calls/end is reflected immediately', async () => {
    mock.hoursToReturn = 100;
    await svc.getMonthlyHoursUsed();
    expect(mock.poolQueryCalls).toBe(1);
    mock.hoursToReturn = 105;
    svc.invalidateMonthlyHoursUsed();
    expect(await svc.getMonthlyHoursUsed()).toBe(105);
    expect(mock.poolQueryCalls).toBe(2);
  });

  it('refetches automatically when the calendar month changes', async () => {
    // Day 28 of some month — well clear of any month-boundary edge case.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-28T12:00:00.000Z'));
    mock.hoursToReturn = 200;
    await svc.getMonthlyHoursUsed();
    expect(mock.poolQueryCalls).toBe(1);

    // Jump into the next calendar month — cache key (YYYY-MM) flips so
    // the cache is invalid even without an explicit invalidate.
    vi.setSystemTime(new Date('2026-06-01T00:00:01.000Z'));
    mock.hoursToReturn = 0; // fresh month, no calls yet
    expect(await svc.getMonthlyHoursUsed()).toBe(0);
    expect(mock.poolQueryCalls).toBe(2);
  });
});

describe('assertUnderMonthlyCap', () => {
  it('passes when usage is below the cap', async () => {
    mock.hoursToReturn = 500;
    await expect(svc.assertUnderMonthlyCap()).resolves.toBeUndefined();
  });

  it('passes at the boundary just before the cap (cap-1 hours)', async () => {
    mock.hoursToReturn = 979.5;
    await expect(svc.assertUnderMonthlyCap()).resolves.toBeUndefined();
  });

  it('throws 503 at exactly the cap (>= boundary, not >)', async () => {
    mock.hoursToReturn = 980;
    let err: { status?: number; message?: string; details?: unknown } | null = null;
    try {
      await svc.assertUnderMonthlyCap();
    } catch (e) {
      err = e as { status?: number; message?: string; details?: unknown };
    }
    expect(err?.status).toBe(503);
    expect(err?.message).toMatch(/Monthly call capacity/);
    // Maintenance-style messaging — user-facing text, not stack trace.
    expect(err?.message).toMatch(/paused until next month/);
  });

  it('throws 503 well past the cap and carries used/cap in details', async () => {
    mock.hoursToReturn = 1500;
    type ApiErr = { status?: number; details?: { used_hours: number; cap_hours: number } };
    let err: ApiErr | null = null;
    try {
      await svc.assertUnderMonthlyCap();
    } catch (e) {
      err = e as ApiErr;
    }
    expect(err?.status).toBe(503);
    expect(err?.details).toEqual({ used_hours: 1500, cap_hours: 980 });
  });

  it('is a no-op when CALLS_MONTHLY_HOUR_CAP=0 (escape hatch for dev/test)', async () => {
    mock.envCap = 0;
    mock.hoursToReturn = 99_999; // even absurd usage doesn't trigger
    await expect(svc.assertUnderMonthlyCap()).resolves.toBeUndefined();
    // Cap=0 short-circuits BEFORE the SQL query — confirms the cheap path.
    expect(mock.poolQueryCalls).toBe(0);
  });

  it('honours a higher cap (e.g. operator bought more Cloudflare capacity)', async () => {
    mock.envCap = 2000;
    mock.hoursToReturn = 1500;
    await expect(svc.assertUnderMonthlyCap()).resolves.toBeUndefined();
  });
});
