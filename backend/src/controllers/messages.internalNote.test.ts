/**
 * Security tests for internal-note messages (is_internal).
 *
 * The hard invariant: a CONSULTANT must never create OR receive an internal
 * note. These tests pin every enforcement point in messages.controller:
 *   - send(): a CONSULTANT sender's is_internal is forced false; a staff sender
 *     persists is_internal=true; the realtime push to a CONSULTANT recipient is
 *     suppressed for an internal note (but the staff sender still gets its echo).
 *   - thread(): a CONSULTANT viewer has internal notes filtered out of the
 *     response; a staff viewer sees them.
 *   - unreadCount(): a CONSULTANT count chains is_internal=false; staff does not.
 *
 * DB, permission service, realtime, and audit are mocked — no Postgres needed.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  canView: true,
  canSend: true,
  rows: {} as Record<string, unknown[]>,
  inserts: [] as { table: string; payload: Record<string, unknown> }[],
  filters: [] as { table: string; method: string; args: unknown[] }[],
}));

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
      eq(col: string, val: unknown) {
        mock.filters.push({ table, method: 'eq', args: [col, val] });
        return b;
      },
      is(col: string, val: unknown) {
        mock.filters.push({ table, method: 'is', args: [col, val] });
        return b;
      },
      or(expr: string) {
        mock.filters.push({ table, method: 'or', args: [expr] });
        return b;
      },
      in: () => b,
      order: () => b,
      limit: () => b,
      update(payload: Record<string, unknown>) {
        void payload;
        return b;
      },
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
import { publishToUser } from '../services/realtime.service';

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
) {
  const res = mkRes();
  try {
    await handler(
      { user, body: opts.body ?? {}, params: opts.params ?? {}, query: {}, log },
      res,
      vi.fn(),
    );
    return { err: null as { status?: number } | null, res };
  } catch (e) {
    return { err: e as { status?: number }, res };
  }
}

beforeEach(() => {
  mock.canView = true;
  mock.canSend = true;
  for (const k of Object.keys(mock.rows)) delete mock.rows[k];
  mock.inserts.length = 0;
  mock.filters.length = 0;
  vi.mocked(publishToUser).mockClear();
});

const RECIP = '00000000-0000-0000-0000-000000000002';
const MANAGER = { id: 'u-mgr', role: 'MANAGER', email: 'mgr@test.local' };
const CONSULTANT = { id: 'u-con', role: 'CONSULTANT', email: 'con@test.local' };

describe('internal notes — send() enforcement', () => {
  it('forces is_internal FALSE for a CONSULTANT sender (consultants cannot create notes)', async () => {
    mock.rows.users = [{ id: RECIP, is_active: true, role: 'RECRUITER' }];
    mock.rows.messages = [{ id: 'm1', sender_id: CONSULTANT.id, recipient_id: RECIP, body: 'hi' }];
    const { err } = await call(messages.send as Handler, CONSULTANT, {
      body: { recipient_id: RECIP, body: 'hi', is_internal: true },
    });
    expect(err).toBeNull();
    const insert = mock.inserts.find((i) => i.table === 'messages');
    expect(insert).toBeDefined();
    // Forced false → the controller never sets the column.
    expect(insert?.payload.is_internal).toBeUndefined();
  });

  it('persists is_internal TRUE for a staff sender', async () => {
    mock.rows.users = [{ id: RECIP, is_active: true, role: 'CONSULTANT' }];
    mock.rows.messages = [
      { id: 'm1', sender_id: MANAGER.id, recipient_id: RECIP, body: 'note', is_internal: true },
    ];
    const { err } = await call(messages.send as Handler, MANAGER, {
      body: { recipient_id: RECIP, body: 'note', is_internal: true },
    });
    expect(err).toBeNull();
    const insert = mock.inserts.find((i) => i.table === 'messages');
    expect(insert?.payload.is_internal).toBe(true);
  });

  it('suppresses the realtime push to a CONSULTANT recipient for an internal note (sender still echoed)', async () => {
    mock.rows.users = [{ id: RECIP, is_active: true, role: 'CONSULTANT' }];
    mock.rows.messages = [
      { id: 'm1', sender_id: MANAGER.id, recipient_id: RECIP, body: 'note', is_internal: true },
    ];
    await call(messages.send as Handler, MANAGER, {
      body: { recipient_id: RECIP, body: 'note', is_internal: true },
    });
    const calls = vi.mocked(publishToUser).mock.calls;
    // No message:new to the consultant recipient…
    expect(calls.some((c) => c[0] === RECIP && c[1] === 'message:new')).toBe(false);
    // …but the staff sender still gets the echo.
    expect(calls.some((c) => c[0] === MANAGER.id && c[1] === 'message:new')).toBe(true);
  });

  it('still pushes a NORMAL message to a consultant recipient (no suppression)', async () => {
    mock.rows.users = [{ id: RECIP, is_active: true, role: 'CONSULTANT' }];
    mock.rows.messages = [{ id: 'm1', sender_id: MANAGER.id, recipient_id: RECIP, body: 'hi' }];
    await call(messages.send as Handler, MANAGER, {
      body: { recipient_id: RECIP, body: 'hi' },
    });
    const calls = vi.mocked(publishToUser).mock.calls;
    expect(calls.some((c) => c[0] === RECIP && c[1] === 'message:new')).toBe(true);
  });
});

describe('internal notes — thread() visibility', () => {
  const PEER = '00000000-0000-0000-0000-000000000003';

  beforeEach(() => {
    mock.rows.messages = [
      { id: 'normal', sender_id: PEER, recipient_id: CONSULTANT.id, is_internal: false },
      { id: 'note', sender_id: PEER, recipient_id: CONSULTANT.id, is_internal: true },
    ];
  });

  it('hides internal notes from a CONSULTANT viewer', async () => {
    const { err, res } = await call(messages.thread as Handler, CONSULTANT, {
      params: { userId: PEER },
    });
    expect(err).toBeNull();
    const ids = (res.body as Array<{ id: string }>).map((m) => m.id);
    expect(ids).toContain('normal');
    expect(ids).not.toContain('note');
  });

  it('shows internal notes to a staff viewer', async () => {
    const { err, res } = await call(messages.thread as Handler, MANAGER, {
      params: { userId: PEER },
    });
    expect(err).toBeNull();
    const ids = (res.body as Array<{ id: string }>).map((m) => m.id);
    expect(ids).toContain('normal');
    expect(ids).toContain('note');
  });
});

describe('internal notes — unreadCount() filtering', () => {
  it('chains is_internal=false for a CONSULTANT', async () => {
    await call(messages.unreadCount as Handler, CONSULTANT, {});
    const f = mock.filters.filter((x) => x.table === 'messages');
    expect(
      f.some((x) => x.method === 'eq' && x.args[0] === 'is_internal' && x.args[1] === false),
    ).toBe(true);
  });

  it('does NOT add the is_internal filter for staff', async () => {
    await call(messages.unreadCount as Handler, MANAGER, {});
    const f = mock.filters.filter((x) => x.table === 'messages');
    expect(f.some((x) => x.method === 'eq' && x.args[0] === 'is_internal')).toBe(false);
  });
});

describe('conversationContext — related-work resolver', () => {
  const PEER = '00000000-0000-0000-0000-000000000003';

  it('returns 403 when canViewConversation denies access', async () => {
    mock.canView = false;
    const { err } = await call(messages.conversationContext as Handler, MANAGER, {
      params: { userId: PEER },
    });
    expect(err?.status).toBe(403);
  });

  it('returns { application: null } for a staff peer (no consultant row)', async () => {
    mock.canView = true;
    mock.rows.consultants = [];
    const { err, res } = await call(messages.conversationContext as Handler, MANAGER, {
      params: { userId: PEER },
    });
    expect(err).toBeNull();
    expect((res.body as { application: unknown }).application).toBeNull();
  });

  it('returns the latest application for a consultant peer', async () => {
    mock.canView = true;
    mock.rows.consultants = [{ id: 'c1' }];
    mock.rows.applications = [{ id: 'a1', status: 'SUBMITTED', submitted_at: null }];
    const { err, res } = await call(messages.conversationContext as Handler, MANAGER, {
      params: { userId: PEER },
    });
    expect(err).toBeNull();
    expect((res.body as { application: { id: string } | null }).application?.id).toBe('a1');
  });

  it('returns null for a non-operator (DEVELOPER) viewer even when they can chat', async () => {
    // DEVELOPER passes canViewConversation (can message everyone) but has no
    // business-data access — the resolver must not leak application/job data.
    mock.canView = true;
    mock.rows.consultants = [{ id: 'c1' }];
    mock.rows.applications = [{ id: 'a1', status: 'SUBMITTED', submitted_at: null }];
    const { err, res } = await call(
      messages.conversationContext as Handler,
      { id: 'u-dev', role: 'DEVELOPER', email: 'd@test.local' },
      { params: { userId: PEER } },
    );
    expect(err).toBeNull();
    expect((res.body as { application: unknown }).application).toBeNull();
  });
});

describe('internal notes — edit() never echoes to a consultant recipient', () => {
  const RECIP2 = '00000000-0000-0000-0000-000000000004';

  it('suppresses message:edited to a consultant recipient for an internal note', async () => {
    mock.rows.messages = [
      {
        id: 'm1',
        recipient_id: RECIP2,
        sender_id: MANAGER.id,
        is_internal: true,
        recipient: { role: 'CONSULTANT' },
      },
    ];
    await call(messages.edit as Handler, MANAGER, {
      params: { id: 'm1' },
      body: { body: 'edited note' },
    });
    const calls = vi.mocked(publishToUser).mock.calls;
    expect(calls.some((c) => c[0] === RECIP2 && c[1] === 'message:edited')).toBe(false);
    expect(calls.some((c) => c[0] === MANAGER.id && c[1] === 'message:edited')).toBe(true);
  });

  it('still echoes a NORMAL edit to a consultant recipient', async () => {
    mock.rows.messages = [
      {
        id: 'm2',
        recipient_id: RECIP2,
        sender_id: MANAGER.id,
        is_internal: false,
        recipient: { role: 'CONSULTANT' },
      },
    ];
    await call(messages.edit as Handler, MANAGER, {
      params: { id: 'm2' },
      body: { body: 'hi there' },
    });
    const calls = vi.mocked(publishToUser).mock.calls;
    expect(calls.some((c) => c[0] === RECIP2 && c[1] === 'message:edited')).toBe(true);
  });
});

describe('setConversationState — pin/archive validation', () => {
  const PEER = '00000000-0000-0000-0000-000000000003';

  it('rejects a non-uuid peer id (400)', async () => {
    const { err } = await call(messages.setConversationState as Handler, MANAGER, {
      params: { userId: 'not-a-uuid' },
      body: { pinned: true },
    });
    expect(err?.status).toBe(400);
  });

  it('rejects unknown body fields (strict schema)', async () => {
    const { err } = await call(messages.setConversationState as Handler, MANAGER, {
      params: { userId: PEER },
      body: { pinned: true, hacked: 1 },
    });
    expect(err?.status).toBe(400);
  });

  it('accepts a valid pin and degrades gracefully pre-migration (200 ok)', async () => {
    const { err, res } = await call(messages.setConversationState as Handler, MANAGER, {
      params: { userId: PEER },
      body: { pinned: true },
    });
    expect(err).toBeNull();
    expect((res.body as { ok?: boolean }).ok).toBe(true);
  });
});
