/**
 * Tests for support.controller (bug-report tickets).
 *   - createTicket: auth, validation, .strict() mass-assignment guard, and that
 *     reporter_id is always taken from req.user.
 *   - listTickets: non-staff are scoped to their own tickets; developers +
 *     admin-tier see the whole queue (no reporter_id filter).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  rows: {} as Record<string, unknown[]>,
  inserts: [] as { table: string; payload: Record<string, unknown> }[],
  filters: [] as { table: string; method: string; args: unknown[] }[],
}));

vi.mock('../config/db', () => {
  function makeBuilder(table: string) {
    const b: Record<string, unknown> = {};
    Object.assign(b, {
      select: () => b,
      order: () => b,
      limit: () => b,
      eq(col: string, val: unknown) {
        mock.filters.push({ table, method: 'eq', args: [col, val] });
        return b;
      },
      insert(payload: Record<string, unknown>) {
        mock.inserts.push({ table, payload });
        return b;
      },
      single: () => Promise.resolve({ data: (mock.rows[table] ?? [])[0] ?? null, error: null }),
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

import * as support from './support.controller';

type Handler = (req: any, res: any, next: any) => unknown | Promise<unknown>;
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
async function call(
  handler: Handler,
  user: { id: string; role: string; email?: string } | undefined,
  opts: { body?: unknown } = {},
) {
  const res = mkRes();
  try {
    await handler({ user, body: opts.body ?? {}, params: {}, query: {} }, res, vi.fn());
    return { err: null as { status?: number } | null, res };
  } catch (e) {
    return { err: e as { status?: number }, res };
  }
}

beforeEach(() => {
  for (const k of Object.keys(mock.rows)) delete mock.rows[k];
  mock.inserts.length = 0;
  mock.filters.length = 0;
});

const RECRUITER = { id: 'u-rec', role: 'RECRUITER', email: 'r@test.local' };
const DEVELOPER = { id: 'u-dev', role: 'DEVELOPER', email: 'd@test.local' };

describe('support.createTicket', () => {
  beforeEach(() => {
    mock.rows.support_tickets = [{ id: 't1', severity: 'low', summary: 'x', status: 'open' }];
  });

  it('401 without a user', async () => {
    const { err } = await call(support.createTicket, undefined, {
      body: { summary: 'a real bug' },
    });
    expect(err?.status).toBe(401);
  });

  it('400 when the summary is too short', async () => {
    const { err } = await call(support.createTicket, RECRUITER, { body: { summary: 'ab' } });
    expect(err?.status).toBe(400);
    expect(mock.inserts).toHaveLength(0);
  });

  it('400 on an unknown body field (strict schema blocks mass-assignment)', async () => {
    const { err } = await call(support.createTicket, RECRUITER, {
      body: { summary: 'a real bug', reporter_id: 'u-attacker', status: 'closed' },
    });
    expect(err?.status).toBe(400);
    expect(mock.inserts).toHaveLength(0);
  });

  it('201 and sets reporter_id from req.user on a valid report', async () => {
    const { err } = await call(support.createTicket, RECRUITER, {
      body: { summary: 'a real bug', severity: 'high' },
    });
    expect(err).toBeNull();
    const insert = mock.inserts.find((i) => i.table === 'support_tickets');
    expect(insert?.payload.reporter_id).toBe(RECRUITER.id);
    expect(insert?.payload.severity).toBe('high');
  });
});

describe('support.listTickets — per-role scoping', () => {
  it('scopes a recruiter to their OWN tickets', async () => {
    await call(support.listTickets, RECRUITER, {});
    expect(
      mock.filters.some(
        (f) => f.method === 'eq' && f.args[0] === 'reporter_id' && f.args[1] === RECRUITER.id,
      ),
    ).toBe(true);
  });

  it('lets a developer see the whole queue (no reporter_id filter)', async () => {
    await call(support.listTickets, DEVELOPER, {});
    expect(mock.filters.some((f) => f.method === 'eq' && f.args[0] === 'reporter_id')).toBe(false);
  });
});
