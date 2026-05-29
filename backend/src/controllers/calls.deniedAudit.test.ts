/**
 * Regression test for `calls_permission_denied` audit emission.
 *
 * Before the fix, `calls.offer` threw 403 on a permission-denied call but
 * did NOT audit the attempt — so abuse / probing of the messaging-permission
 * boundary was invisible. The `messages` side already audits denials; calls
 * now match that pattern.
 *
 * This test mocks the DB shim + permission service so we can flip the
 * permission result and assert the audit verb fires only on denial.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mock = vi.hoisted(() => ({
  allowed: true as boolean,
  auditCalls: [] as Array<{ action: string; user_id?: string | null; metadata?: unknown }>,
}));

vi.mock('../config/db', () => {
  function builder() {
    const b: Record<string, unknown> = {};
    Object.assign(b, {
      select: () => b,
      eq: () => b,
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
    });
    return b;
  }
  return {
    db: { from: () => builder() },
    pool: { query: vi.fn(async () => ({ rows: [{ id: 'call-1' }] })) },
  };
});

vi.mock('../services/permission.service', () => ({
  canMessageUser: vi.fn(async () => mock.allowed),
}));

vi.mock('../services/realtime.service', () => ({
  publishToUser: vi.fn(async () => undefined),
}));

vi.mock('../services/audit.service', () => ({
  audit: (entry: { action: string; user_id?: string | null; metadata?: unknown }) => {
    mock.auditCalls.push(entry);
  },
}));

vi.mock('../config/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { offer } from './calls.controller';

function mkRes() {
  const res: {
    statusCode: number;
    body: unknown;
    status: (c: number) => any;
    json: (b: unknown) => any;
  } = {
    statusCode: 200,
    body: undefined,
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(b) {
      this.body = b;
      return this;
    },
  };
  return res;
}

const ME = {
  id: '11111111-1111-1111-1111-111111111111',
  email: 'caller@x.test',
  role: 'CONSULTANT',
  group_id: null,
};

const CALLEE = '22222222-2222-2222-2222-222222222222';

beforeEach(() => {
  mock.allowed = true;
  mock.auditCalls.length = 0;
});

describe('calls.offer — denied attempts are audited', () => {
  it('does NOT emit calls_permission_denied when the call is permitted', async () => {
    mock.allowed = true;
    const res = mkRes();
    await (offer as any)(
      {
        user: ME,
        body: { callee_id: CALLEE, call_type: 'audio', sdp: 'v=0' },
        params: {},
      },
      res,
      vi.fn(),
    );
    expect(mock.auditCalls.find((a) => a.action === 'calls_permission_denied')).toBeUndefined();
  });

  it('emits calls_permission_denied + throws 403 when canMessageUser returns false', async () => {
    mock.allowed = false;
    const res = mkRes();
    let thrown: { status?: number } | null = null;
    try {
      await (offer as any)(
        {
          user: ME,
          body: { callee_id: CALLEE, call_type: 'audio', sdp: 'v=0' },
          params: {},
        },
        res,
        vi.fn(),
      );
    } catch (e) {
      thrown = e as { status?: number };
    }
    expect(thrown?.status).toBe(403);
    const denial = mock.auditCalls.find((a) => a.action === 'calls_permission_denied');
    expect(denial).toBeDefined();
    expect(denial?.user_id).toBe(ME.id);
    expect((denial?.metadata as { callee_id?: string })?.callee_id).toBe(CALLEE);
  });
});
