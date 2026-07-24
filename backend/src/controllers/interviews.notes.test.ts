/**
 * Regression: scheduling/updating an interview must not 500 when the `notes`
 * column hasn't been migrated yet. The Schedule-interview modal sends `notes`,
 * but the interviews table gained the column late — so the controller strips
 * `notes` and retries the INSERT/UPDATE on a missing-column error (deploy-ahead
 * safe). This pins that behaviour.
 *
 * The db mock returns a "column does not exist" error for any interviews
 * insert/update whose payload still carries `notes`, and succeeds once it's
 * stripped — exactly the production failure mode.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mock = vi.hoisted(() => ({ interviewWrites: [] as Record<string, unknown>[] }));

vi.mock('../config/db', () => {
  function makeBuilder(table: string) {
    let payload: Record<string, unknown> | null = null;
    const b: Record<string, unknown> = {};
    Object.assign(b, {
      select: () => b,
      eq: () => b,
      neq: () => b,
      is: () => b,
      in: () => b,
      not: () => b,
      gt: () => b,
      gte: () => b,
      lte: () => b,
      order: () => b,
      limit: () => b,
      update: (p: Record<string, unknown>) => {
        payload = p;
        if (table === 'interviews') mock.interviewWrites.push(p);
        return b;
      },
      insert: (p: Record<string, unknown>) => {
        payload = p;
        if (table === 'interviews') mock.interviewWrites.push(p);
        return b;
      },
      maybeSingle: () =>
        Promise.resolve({
          data:
            table === 'interviews'
              ? { id: 'iv-1', consultant_id: 'c1', created_by: 'u-dir' }
              : null,
          error: null,
        }),
      single: () => {
        if (table === 'interviews' && payload && 'notes' in payload) {
          return Promise.resolve({
            data: null,
            error: { message: 'column "notes" of relation "interviews" does not exist' },
          });
        }
        return Promise.resolve({ data: { id: 'iv-1', ...(payload ?? {}) }, error: null });
      },
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: [], error: null }).then(resolve),
    });
    return b;
  }
  return { db: { from: (t: string) => makeBuilder(t) }, pool: {} };
});
vi.mock('../config/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../services/interviewReminders.service', () => ({ syncInterviewReminders: vi.fn() }));
vi.mock('../services/realtime.service', () => ({ publishToUser: vi.fn() }));

import * as interviews from './interviews.controller';

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
  user: { id: string; role: string } | undefined,
  opts: { body?: unknown; params?: Record<string, string> } = {},
): Promise<{ err: { status?: number } | null; res: ReturnType<typeof mkRes> }> {
  const res = mkRes();
  try {
    await handler({ user, body: opts.body ?? {}, params: opts.params ?? {} }, res, vi.fn());
    return { err: null, res };
  } catch (e) {
    return { err: e as { status?: number }, res };
  }
}

// DIRECTOR is admin-tier → authorizeCreateForConsultant short-circuits (no DB).
const ADMIN = { id: 'u-dir', role: 'DIRECTOR' };
const CONSULTANT_ID = '00000000-0000-4000-8000-000000000001';

beforeEach(() => {
  mock.interviewWrites.length = 0;
});

describe('interviews schedule — notes column not migrated', () => {
  it('strips notes and retries on a missing-column error (201, not 500)', async () => {
    const { err, res } = await call(interviews.schedule as Handler, ADMIN, {
      body: {
        consultant_id: CONSULTANT_ID,
        type: 'PHONE',
        scheduled_at: '2026-06-02T11:30:00.000Z',
        interviewer: 'CVS',
        duration_minutes: 30,
        meeting_url: 'https://teams.microsoft.com/meet/123',
        notes: null,
      },
    });
    expect(err).toBeNull();
    expect(res.statusCode).toBe(201);
    expect(res.body).toMatchObject({ id: 'iv-1' });
    // Two write attempts: first with notes (errors), retry without notes (ok).
    expect(mock.interviewWrites.length).toBe(2);
    expect('notes' in mock.interviewWrites[0]).toBe(true);
    expect('notes' in mock.interviewWrites[1]).toBe(false);
  });

  it('inserts once when no notes are supplied', async () => {
    const { err, res } = await call(interviews.schedule as Handler, ADMIN, {
      body: {
        consultant_id: CONSULTANT_ID,
        type: 'PHONE',
        scheduled_at: '2026-06-02T11:30:00.000Z',
      },
    });
    expect(err).toBeNull();
    expect(res.statusCode).toBe(201);
    expect(mock.interviewWrites.length).toBe(1);
  });
});

describe('interviews update — notes column not migrated', () => {
  it('strips notes and retries on a missing-column error', async () => {
    const { err, res } = await call(interviews.update as Handler, ADMIN, {
      params: { id: 'iv-1' },
      body: { scheduled_at: '2026-06-02T12:00:00.000Z', notes: 'reschedule note' },
    });
    expect(err).toBeNull();
    expect(res.body).toMatchObject({ id: 'iv-1' });
    expect(mock.interviewWrites.length).toBe(2);
    expect('notes' in mock.interviewWrites[1]).toBe(false);
  });
});
