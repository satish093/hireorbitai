/**
 * Regression test for multi-tab callee clearance.
 *
 * Pre-fix: answer() / reject() only fanned out to the caller. The callee's
 * OTHER tabs (laptop + phone + stale tabs) never received any signal, so
 * they kept ringing + vibrating forever. Real-world user pain: phone
 * keeps ringing in a meeting after the laptop answers.
 *
 * Fix: each handler now ALSO publishes a `call:accepted-elsewhere` /
 * `call:rejected-elsewhere` event to the callee's own user id. Each tab
 * guards on call_id and ignores its own copy.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  published: [] as Array<{ userId: string; event: string; payload: unknown }>,
  poolReturn: { rows: [{ caller_id: 'u-caller' }] } as { rows: Array<{ caller_id: string }> },
}));

vi.mock('../config/db', () => ({
  db: { from: () => ({}) },
  pool: { query: vi.fn(async () => mock.poolReturn) },
}));
vi.mock('../services/realtime.service', () => ({
  publishToUser: vi.fn(async (userId: string, event: string, payload: unknown) => {
    mock.published.push({ userId, event, payload });
  }),
}));
vi.mock('../services/permission.service', () => ({
  canMessageUser: vi.fn(async () => true),
}));
vi.mock('../services/audit.service', () => ({ audit: vi.fn() }));
vi.mock('../config/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { answer, reject } from './calls.controller';

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

const CALLEE = {
  id: '22222222-2222-2222-2222-222222222222',
  email: 'callee@x.test',
  role: 'CONSULTANT',
  group_id: null,
};
const CALL_ID = '11111111-1111-1111-1111-111111111111';
const CALLER_ID = '33333333-3333-3333-3333-333333333333';

beforeEach(() => {
  mock.published.length = 0;
  mock.poolReturn = { rows: [{ caller_id: CALLER_ID }] };
});

describe('calls.answer — multi-tab clearance', () => {
  it('fans out call:answered to caller AND call:accepted-elsewhere to callee self', async () => {
    const res = mkRes();
    await (answer as any)(
      {
        user: CALLEE,
        body: { call_id: CALL_ID, caller_id: CALLER_ID, sdp: 'v=0' },
        params: {},
      },
      res,
      vi.fn(),
    );
    const events = mock.published.map((p) => ({ userId: p.userId, event: p.event }));
    expect(events).toContainEqual({ userId: CALLER_ID, event: 'call:answered' });
    expect(events).toContainEqual({ userId: CALLEE.id, event: 'call:accepted-elsewhere' });
    // The accepted-elsewhere payload must carry call_id so other tabs can
    // guard on it (they ignore copies for unrelated calls).
    const elsewhere = mock.published.find((p) => p.event === 'call:accepted-elsewhere');
    expect((elsewhere?.payload as { call_id?: string })?.call_id).toBe(CALL_ID);
  });
});

describe('calls.reject — multi-tab clearance', () => {
  it('fans out call:rejected to caller AND call:rejected-elsewhere to callee self', async () => {
    const res = mkRes();
    await (reject as any)(
      {
        user: CALLEE,
        body: { call_id: CALL_ID, caller_id: CALLER_ID },
        params: {},
      },
      res,
      vi.fn(),
    );
    const events = mock.published.map((p) => ({ userId: p.userId, event: p.event }));
    expect(events).toContainEqual({ userId: CALLER_ID, event: 'call:rejected' });
    expect(events).toContainEqual({ userId: CALLEE.id, event: 'call:rejected-elsewhere' });
  });
});
