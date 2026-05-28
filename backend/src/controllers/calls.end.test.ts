import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  rows: [] as Array<{ caller_id: string; callee_id: string }>,
  query: null as { sql: string; params: unknown[] } | null,
  published: [] as Array<{ userId: string; event: string; payload: unknown }>,
}));

vi.mock('../config/db', () => ({
  db: {},
  pool: {
    query: vi.fn(async (sql: string, params: unknown[]) => {
      state.query = { sql, params };
      return { rows: state.rows };
    }),
  },
}));

vi.mock('../services/realtime.service', () => ({
  publishToUser: vi.fn(async (userId: string, event: string, payload: unknown) => {
    state.published.push({ userId, event, payload });
  }),
}));

import { end } from './calls.controller';

const CALL_ID = '11111111-1111-4111-8111-111111111111';
const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const USER_X = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function res() {
  return {
    body: null as unknown,
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };
}

async function callEnd(userId: string, peerId: string) {
  const r = res();
  try {
    await (end as any)(
      {
        user: { id: userId, role: 'RECRUITER', email: `${userId}@x.test` },
        body: {
          call_id: CALL_ID,
          peer_id: peerId,
        },
      },
      r,
      vi.fn(),
    );
    return { err: null as any, res: r };
  } catch (err) {
    return { err: err as any, res: r };
  }
}

describe('calls.end', () => {
  beforeEach(() => {
    state.rows = [];
    state.query = null;
    state.published = [];
  });

  it('updates only when the caller is a participant', async () => {
    state.rows = [{ caller_id: USER_A, callee_id: USER_B }];

    const { err, res } = await callEnd(USER_A, USER_B);

    expect(err).toBeNull();
    expect(res.body).toEqual({ ok: true });
    expect(state.query?.params).toEqual([CALL_ID, USER_A]);
    expect(state.query?.sql).toContain('(caller_id = $2 OR callee_id = $2)');
    expect(state.published).toEqual([
      { userId: USER_B, event: 'call:ended', payload: { call_id: CALL_ID } },
    ]);
  });

  it('does not publish when no participant row was updated', async () => {
    state.rows = [];

    const { err } = await callEnd(USER_X, USER_B);

    expect(err?.status).toBe(404);
    expect(state.published).toEqual([]);
  });

  it('rejects sending the end event to self', async () => {
    state.rows = [{ caller_id: USER_A, callee_id: USER_B }];

    const { err } = await callEnd(USER_A, USER_A);

    expect(err?.status).toBe(400);
    expect(state.published).toEqual([]);
  });
});
