/**
 * Tests for GET /calls-usage — the org-wide monthly call-hour budget
 * dashboard endpoint exposed to OWNER_TIER + DEVELOPER-with-capability.
 *
 * Pins the response shape the frontend dashboard card relies on:
 *   - used_hours (rounded to 2dp)
 *   - cap_hours (env.calls.monthlyHourCap)
 *   - cap_active (false when env=0)
 *   - percent_used (clamped 0..100, null when cap_active=false)
 *   - cap_reached (used_hours >= cap_hours)
 *   - reset_at_utc (00:00 UTC on the 1st of next month)
 *
 * Auth gating is handled at the route mount (requireRoleOrCapability) and
 * already covered by the existing rbacMatrix test infra; here we only
 * verify the handler shape against the cached budget service.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  usedHours: 0,
  cap: 980,
}));

vi.mock('../config/db', () => ({ db: { from: () => ({}) }, pool: {} }));
vi.mock('../config/env', () => ({
  get env() {
    return { calls: { monthlyHourCap: mock.cap } };
  },
}));
vi.mock('../services/callsBudget.service', () => ({
  getMonthlyHoursUsed: vi.fn(async () => mock.usedHours),
  invalidateMonthlyHoursUsed: vi.fn(),
  assertUnderMonthlyCap: vi.fn(),
}));
vi.mock('../services/permission.service', () => ({ canMessageUser: vi.fn() }));
vi.mock('../services/realtime.service', () => ({ publishToUser: vi.fn() }));
vi.mock('../services/audit.service', () => ({ audit: vi.fn() }));
vi.mock('../config/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { usage } from './calls.controller';

function mkRes() {
  const res: any = {
    statusCode: 200,
    body: undefined,
    status(c: number) {
      this.statusCode = c;
      return this;
    },
    json(b: unknown) {
      this.body = b;
      return this;
    },
  };
  return res;
}

const USER = { id: 'u-1', role: 'SUPER_ADMIN', email: 'sa@x.test' };

beforeEach(() => {
  mock.usedHours = 0;
  mock.cap = 980;
});

afterEach(() => {
  vi.useRealTimers();
});

async function call(): Promise<{ res: ReturnType<typeof mkRes>; err: { status?: number } | null }> {
  const res = mkRes();
  try {
    await (usage as any)({ user: USER, body: {}, params: {} }, res, vi.fn());
    return { res, err: null };
  } catch (e) {
    return { res, err: e as { status?: number } };
  }
}

describe('calls.usage — response shape', () => {
  it('zero usage on an empty month', async () => {
    mock.usedHours = 0;
    const { res } = await call();
    expect(res.body).toMatchObject({
      used_hours: 0,
      cap_hours: 980,
      cap_active: true,
      percent_used: 0,
      cap_reached: false,
    });
  });

  it('rounds used_hours to 2 decimal places', async () => {
    mock.usedHours = 12.3456789;
    const { res } = await call();
    expect((res.body as { used_hours: number }).used_hours).toBe(12.35);
  });

  it('rounds percent_used to 1 decimal place', async () => {
    mock.usedHours = 100; // 100/980 = 10.2040...%
    const { res } = await call();
    expect((res.body as { percent_used: number }).percent_used).toBe(10.2);
  });

  it('clamps percent_used to 100 when usage exceeds cap', async () => {
    mock.usedHours = 1500;
    const { res } = await call();
    const body = res.body as { percent_used: number; cap_reached: boolean };
    expect(body.percent_used).toBe(100);
    expect(body.cap_reached).toBe(true);
  });

  it('flips cap_reached at the exact cap boundary', async () => {
    mock.usedHours = 980;
    const { res } = await call();
    expect((res.body as { cap_reached: boolean }).cap_reached).toBe(true);
  });

  it('cap_active=false and percent_used=null when CALLS_MONTHLY_HOUR_CAP=0', async () => {
    mock.cap = 0;
    mock.usedHours = 50;
    const { res } = await call();
    const body = res.body as {
      cap_active: boolean;
      percent_used: number | null;
      cap_reached: boolean;
    };
    expect(body.cap_active).toBe(false);
    expect(body.percent_used).toBeNull();
    expect(body.cap_reached).toBe(false);
  });

  it('reset_at_utc is 00:00 UTC on the 1st of next month', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-15T14:32:00.000Z'));
    const { res } = await call();
    expect((res.body as { reset_at_utc: string }).reset_at_utc).toBe('2026-06-01T00:00:00.000Z');
  });

  it('reset_at_utc rolls correctly across the December → January year boundary', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-12-28T23:59:59.000Z'));
    const { res } = await call();
    expect((res.body as { reset_at_utc: string }).reset_at_utc).toBe('2027-01-01T00:00:00.000Z');
  });
});
