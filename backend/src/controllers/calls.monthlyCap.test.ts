/**
 * Controller-level regression test for the 980 hr monthly cap.
 *
 * Pins:
 *   - offer() under cap proceeds (smoke — existing happy path unchanged).
 *   - offer() at-or-over cap returns 503 + emits calls_monthly_cap_reached
 *     audit with the actual used/cap numbers + NEVER writes the calls
 *     row (the INSERT must not run when the cap blocks the offer).
 *   - end() UPDATE writes duration_seconds derived from started_at and
 *     invalidates the budget cache so the next /offer sees the new total.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  budgetThrows: false,
  budgetUsed: 0,
  cap: 980,
  invalidateCalls: 0,
  audits: [] as Array<{ action: string; metadata?: Record<string, unknown> }>,
  poolQueries: [] as Array<{ sql: string; params?: unknown[] }>,
  endRow: {
    caller_id: '11111111-1111-1111-1111-111111111111',
    callee_id: '22222222-2222-2222-2222-222222222222',
  },
}));

vi.mock('../config/db', () => ({
  db: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: {
              id: 'caller',
              full_name: 'Caller Name',
              email: 'caller@x.test',
              role: 'RECRUITER',
            },
            error: null,
          }),
        }),
      }),
    }),
  },
  pool: {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      mock.poolQueries.push({ sql, params });
      if (/INSERT INTO public\.calls/.test(sql)) {
        return { rows: [{ id: '33333333-3333-3333-3333-333333333333' }] };
      }
      if (/UPDATE public\.calls/.test(sql)) {
        return { rows: [mock.endRow] };
      }
      return { rows: [] };
    }),
  },
}));

vi.mock('../services/permission.service', () => ({
  canMessageUser: vi.fn(async () => true),
}));
vi.mock('../services/realtime.service', () => ({
  publishToUser: vi.fn(async () => undefined),
}));
vi.mock('../services/audit.service', () => ({
  audit: (entry: { action: string; metadata?: Record<string, unknown> }) => {
    mock.audits.push(entry);
  },
}));
vi.mock('../services/callsBudget.service', () => ({
  assertUnderMonthlyCap: vi.fn(async () => {
    if (mock.budgetThrows) {
      const e: Error & { status?: number; details?: unknown } = new Error(
        'Monthly call capacity reached — service paused until next month',
      );
      e.status = 503;
      e.details = { used_hours: mock.budgetUsed, cap_hours: mock.cap };
      throw e;
    }
  }),
  getMonthlyHoursUsed: vi.fn(async () => mock.budgetUsed),
  invalidateMonthlyHoursUsed: () => {
    mock.invalidateCalls++;
  },
}));
vi.mock('../config/env', () => ({
  env: { calls: { monthlyHourCap: 980 } },
}));
vi.mock('../config/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { offer, end } from './calls.controller';

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

const ME = {
  id: '11111111-1111-1111-1111-111111111111',
  email: 'caller@x.test',
  role: 'RECRUITER',
  group_id: null,
};

beforeEach(() => {
  mock.budgetThrows = false;
  mock.budgetUsed = 0;
  mock.invalidateCalls = 0;
  mock.audits.length = 0;
  mock.poolQueries.length = 0;
});

describe('calls.offer — monthly cap gate', () => {
  it('proceeds normally when under the cap (INSERT runs, no cap audit)', async () => {
    mock.budgetThrows = false;
    const res = mkRes();
    await (offer as any)(
      {
        user: ME,
        body: {
          callee_id: '22222222-2222-2222-2222-222222222222',
          call_type: 'audio',
          sdp: 'v=0',
        },
        params: {},
      },
      res,
      vi.fn(),
    );
    expect(mock.poolQueries.some((q) => /INSERT INTO public\.calls/.test(q.sql))).toBe(true);
    expect(mock.audits.find((a) => a.action === 'calls_monthly_cap_reached')).toBeUndefined();
  });

  it('returns 503 + emits calls_monthly_cap_reached when cap is hit; NO INSERT happens', async () => {
    mock.budgetThrows = true;
    mock.budgetUsed = 1024;
    const res = mkRes();
    let thrown: { status?: number; message?: string } | null = null;
    try {
      await (offer as any)(
        {
          user: ME,
          body: {
            callee_id: '22222222-2222-2222-2222-222222222222',
            call_type: 'audio',
            sdp: 'v=0',
          },
          params: {},
        },
        res,
        vi.fn(),
      );
    } catch (e) {
      thrown = e as { status?: number; message?: string };
    }
    expect(thrown?.status).toBe(503);
    expect(thrown?.message).toMatch(/Monthly call capacity/);

    // Critical: the INSERT must NOT run when the cap blocks the offer.
    // Otherwise we'd be persisting ringing-state rows for refused calls.
    expect(mock.poolQueries.find((q) => /INSERT INTO public\.calls/.test(q.sql))).toBeUndefined();

    const a = mock.audits.find((a) => a.action === 'calls_monthly_cap_reached');
    expect(a).toBeDefined();
    expect(a?.metadata).toMatchObject({
      callee_id: '22222222-2222-2222-2222-222222222222',
      used_hours: 1024,
      cap_hours: 980,
    });
  });
});

describe('calls.end — duration capture', () => {
  it('UPDATE writes duration_seconds derived from started_at and invalidates the budget cache', async () => {
    const res = mkRes();
    await (end as any)(
      {
        user: ME,
        body: {
          call_id: '33333333-3333-3333-3333-333333333333',
          peer_id: '22222222-2222-2222-2222-222222222222',
        },
        params: {},
      },
      res,
      vi.fn(),
    );
    const upd = mock.poolQueries.find((q) => /UPDATE public\.calls/.test(q.sql));
    expect(upd).toBeDefined();
    // The UPDATE must set duration_seconds from started_at AND guard
    // against NULL started_at (caller cancelled before pickup) so we
    // don't store a negative/nonsensical duration.
    expect(upd!.sql).toMatch(/duration_seconds/);
    expect(upd!.sql).toMatch(/started_at IS NULL/);
    expect(upd!.sql).toMatch(/GREATEST\(0,/);
    expect(upd!.sql).toMatch(/EXTRACT\(EPOCH FROM \(now\(\) - started_at\)\)/);

    // Cache invalidation MUST run after a successful end so the next
    // /offer sees the freshly-finished call's duration immediately
    // instead of waiting up to 60 s for the cache TTL.
    expect(mock.invalidateCalls).toBe(1);
  });
});
