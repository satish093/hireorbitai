/**
 * IDOR regression tests for messages.controller.
 *
 * Pins the authorization model for the most sensitive message endpoints:
 *   1. thread()   — GET /messages/with/:userId
 *      canViewConversation() gates every thread fetch; a denied caller gets 403.
 *   2. send()     — POST /messages  (body: { recipient_id, body })
 *      canMessageUser() gates sends; sender_id is always set server-side from
 *      req.user — the body cannot inject a different sender.
 *   3. markRead() — POST /messages/with/:userId/read
 *      canViewConversation() gates this too; no unauthorized read-receipts.
 *
 * The permission service, realtime service, audit service, and DB are all
 * mocked so no real Postgres is needed.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock state
// ---------------------------------------------------------------------------

const mock = vi.hoisted(() => ({
  canView: true,
  canSend: true,
  rows: {} as Record<string, unknown[]>,
  inserts: [] as { table: string; payload: Record<string, unknown> }[],
}));

// ---------------------------------------------------------------------------
// Module mocks — must be hoisted before any imports
// ---------------------------------------------------------------------------

vi.mock('../services/permission.service', () => ({
  canViewConversation: vi.fn(async () => mock.canView),
  canMessageUser: vi.fn(async () => mock.canSend),
  getAccessibleUserIds: vi.fn(async () => new Set<string>()),
  invalidatePermissionCache: vi.fn(),
}));

vi.mock('../services/audit.service', () => ({ audit: vi.fn() }));
vi.mock('../services/realtime.service', () => ({ publishToUser: vi.fn() }));

vi.mock('../config/db', () => {
  function makeBuilder(table: string) {
    const b: Record<string, unknown> = {};
    Object.assign(b, {
      select: () => b,
      eq: () => b,
      is: () => b,
      or: () => b,
      in: () => b,
      order: () => b,
      limit: () => b,
      update: () => b,
      insert(payload: Record<string, unknown>) {
        mock.inserts.push({ table, payload });
        return b;
      },
      maybeSingle: () =>
        Promise.resolve({ data: (mock.rows[table] ?? [])[0] ?? null, error: null }),
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

import * as messages from './messages.controller';
import { canViewConversation, canMessageUser } from '../services/permission.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

async function call(
  handler: Handler,
  user: { id: string; role: string; email?: string } | undefined,
  opts: { body?: unknown; params?: Record<string, string> } = {},
): Promise<{ err: { status?: number } | null; res: ReturnType<typeof mkRes> }> {
  const res = mkRes();
  try {
    await handler(
      { user, body: opts.body ?? {}, params: opts.params ?? {}, query: {}, log },
      res,
      vi.fn(),
    );
    return { err: null, res };
  } catch (e) {
    return { err: e as { status?: number }, res };
  }
}

beforeEach(() => {
  mock.canView = true;
  mock.canSend = true;
  for (const k of Object.keys(mock.rows)) delete mock.rows[k];
  mock.inserts.length = 0;
  vi.mocked(canViewConversation).mockImplementation(async () => mock.canView);
  vi.mocked(canMessageUser).mockImplementation(async () => mock.canSend);
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ALICE = { id: 'u-alice', role: 'MANAGER', email: 'alice@test.local' };
const BOB_ID = 'u-bob-' + '0'.repeat(28); // valid UUID-ish for Zod

// ---------------------------------------------------------------------------
// thread() — GET /messages/with/:userId
// ---------------------------------------------------------------------------

describe('messages.thread — IDOR authorization', () => {
  it('returns messages when canViewConversation grants access', async () => {
    mock.canView = true;
    mock.rows.messages = [{ id: 'm-1', sender_id: ALICE.id, recipient_id: BOB_ID }];
    const { err, res } = await call(messages.thread as Handler, ALICE, {
      params: { userId: BOB_ID },
    });
    expect(err).toBeNull();
    expect(Array.isArray(res.body)).toBe(true);
    expect(canViewConversation).toHaveBeenCalledWith(
      expect.objectContaining({ id: ALICE.id }),
      BOB_ID,
    );
  });

  it('returns 403 when canViewConversation denies access', async () => {
    mock.canView = false;
    const { err } = await call(messages.thread as Handler, ALICE, {
      params: { userId: BOB_ID },
    });
    expect(err?.status).toBe(403);
  });

  it('returns 400 when caller and target are the same user (self-chat)', async () => {
    const { err } = await call(messages.thread as Handler, ALICE, {
      params: { userId: ALICE.id },
    });
    expect(err?.status).toBe(400);
  });

  it('returns 401 when req.user is missing', async () => {
    const { err } = await call(messages.thread as Handler, undefined, {
      params: { userId: BOB_ID },
    });
    expect(err?.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// send() — POST /messages  (body: { recipient_id, body })
// ---------------------------------------------------------------------------

describe('messages.send — authorization + server-side sender_id', () => {
  const VALID_RECIPIENT_UUID = '00000000-0000-0000-0000-000000000002';

  beforeEach(() => {
    // send() does a recipient existence check — supply a valid active user row.
    mock.rows.users = [{ id: VALID_RECIPIENT_UUID, is_active: true }];
    // send() re-reads the inserted message by id for the response.
    mock.rows.messages = [
      {
        id: 'm-new',
        sender_id: ALICE.id,
        recipient_id: VALID_RECIPIENT_UUID,
        body: 'hello',
      },
    ];
  });

  it('returns 403 and makes no DB insert when canMessageUser denies access', async () => {
    mock.canSend = false;
    const { err } = await call(messages.send as Handler, ALICE, {
      body: { recipient_id: VALID_RECIPIENT_UUID, body: 'hello' },
    });
    expect(err?.status).toBe(403);
    expect(mock.inserts).toHaveLength(0);
  });

  it('sets sender_id from req.user.id, ignores sender_id in body', async () => {
    mock.canSend = true;
    const { err } = await call(messages.send as Handler, ALICE, {
      body: {
        recipient_id: VALID_RECIPIENT_UUID,
        body: 'hello',
        // Attacker attempts to spoof sender — Zod strips unknown fields,
        // and the controller always writes req.user.id regardless.
        sender_id: 'u-attacker',
      },
    });
    expect(err).toBeNull();
    const insert = mock.inserts.find((i) => i.table === 'messages');
    expect(insert).toBeDefined();
    expect(insert?.payload.sender_id).toBe(ALICE.id);
    expect(insert?.payload.sender_id).not.toBe('u-attacker');
  });

  it('returns 400 when body is empty string (min-length validation)', async () => {
    const { err } = await call(messages.send as Handler, ALICE, {
      body: { recipient_id: VALID_RECIPIENT_UUID, body: '' },
    });
    expect(err?.status).toBe(400);
    expect(mock.inserts).toHaveLength(0);
  });

  it('returns 400 when caller tries to message themselves', async () => {
    const { err } = await call(messages.send as Handler, ALICE, {
      body: { recipient_id: ALICE.id, body: 'hello me' },
    });
    expect(err?.status).toBe(400);
  });

  it('returns 400 when recipient_id is not a valid UUID', async () => {
    const { err } = await call(messages.send as Handler, ALICE, {
      body: { recipient_id: 'not-a-uuid', body: 'hello' },
    });
    expect(err?.status).toBe(400);
  });

  it('returns 401 when req.user is missing', async () => {
    const { err } = await call(messages.send as Handler, undefined, {
      body: { recipient_id: VALID_RECIPIENT_UUID, body: 'hi' },
    });
    expect(err?.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// markRead() — POST /messages/with/:userId/read
// ---------------------------------------------------------------------------

describe('messages.markRead — authorization guard', () => {
  it('returns 403 when canViewConversation denies access', async () => {
    mock.canView = false;
    const { err } = await call(messages.markRead as Handler, ALICE, {
      params: { userId: BOB_ID },
    });
    expect(err?.status).toBe(403);
  });

  it('returns 401 when req.user is missing', async () => {
    const { err } = await call(messages.markRead as Handler, undefined, {
      params: { userId: BOB_ID },
    });
    expect(err?.status).toBe(401);
  });

  it('succeeds (200) when canViewConversation grants access', async () => {
    mock.canView = true;
    const { err, res } = await call(messages.markRead as Handler, ALICE, {
      params: { userId: BOB_ID },
    });
    expect(err).toBeNull();
    expect(res.body).toMatchObject({ ok: true });
  });
});
