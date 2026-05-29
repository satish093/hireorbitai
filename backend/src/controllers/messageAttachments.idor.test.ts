/**
 * IDOR + scope regression for messageAttachments.controller.
 *
 * Three audit invariants this test pins:
 *
 *   1) `upload` is gated by `canMessageUser`. A user who is NOT permitted
 *      to DM the recipient cannot burn disk uploading an orphan attachment
 *      (would create an exfil surface — the signed URL is then in the
 *      uploader's row even though they can't actually send).
 *
 *   2) `claimAttachmentsForMessage` silently drops attachment ids whose
 *      uploaded_by != sender, recipient_user_id != message recipient, or
 *      message_id is already non-null. Without this, an attacker who
 *      guesses another user's attachment id could attach someone else's
 *      file to their own message (exfil via the sender's conversation
 *      view).
 *
 *   3) `remove` is uploader-only — admins / leads / recipient cannot
 *      delete each other's attachments. Returns 404 (not 403) on
 *      ownership mismatch, same convention as the rest of the messages
 *      surface, so the endpoint isn't an existence oracle.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock state
// ---------------------------------------------------------------------------

const mock = vi.hoisted(() => ({
  canSend: true,
  rows: {} as Record<string, unknown[]>,
  inserts: [] as { table: string; payload: Record<string, unknown> }[],
  updates: [] as { table: string; payload: Record<string, unknown> }[],
  deletes: [] as { table: string }[],
  filters: [] as { table: string; method: 'eq' | 'is' | 'in'; args: unknown[] }[],
  storageUploaded: [] as string[],
  storageRemoved: [] as string[],
}));

// ---------------------------------------------------------------------------
// Module mocks — must be hoisted before any imports
// ---------------------------------------------------------------------------

vi.mock('../services/permission.service', () => ({
  canMessageUser: vi.fn(async () => mock.canSend),
  canViewConversation: vi.fn(async () => true),
  getAccessibleUserIds: vi.fn(async () => new Set<string>()),
  invalidatePermissionCache: vi.fn(),
}));

vi.mock('../services/audit.service', () => ({ audit: vi.fn() }));
vi.mock('../services/realtime.service', () => ({ publishToUser: vi.fn() }));

vi.mock('../config/db', () => {
  const storageBuilder = {
    upload: vi.fn(async (path: string) => {
      mock.storageUploaded.push(path);
      return { error: null };
    }),
    remove: vi.fn(async (paths: string[]) => {
      for (const p of paths) mock.storageRemoved.push(p);
      return { error: null };
    }),
    createSignedUrl: vi.fn(async (path: string) => ({
      data: { signedUrl: `https://signed.test/${path}` },
      error: null,
    })),
  };
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
      in(col: string, vals: unknown) {
        mock.filters.push({ table, method: 'in', args: [col, vals] });
        return b;
      },
      order: () => b,
      limit: () => b,
      update(payload: Record<string, unknown>) {
        mock.updates.push({ table, payload });
        return b;
      },
      insert(payload: Record<string, unknown>) {
        mock.inserts.push({ table, payload });
        return b;
      },
      delete() {
        mock.deletes.push({ table });
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
  return {
    db: {
      from: (t: string) => makeBuilder(t),
      storage: { from: () => storageBuilder },
    },
    pool: {},
  };
});

vi.mock('../config/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import * as attachments from './messageAttachments.controller';
import { canMessageUser } from '../services/permission.service';

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

async function call(
  handler: Handler,
  user: { id: string; role: string; email?: string } | undefined,
  opts: {
    body?: unknown;
    params?: Record<string, string>;
    file?: { originalname: string; buffer: Buffer; mimetype: string };
  } = {},
): Promise<{ err: { status?: number } | null; res: ReturnType<typeof mkRes> }> {
  const res = mkRes();
  try {
    await handler(
      { user, body: opts.body ?? {}, params: opts.params ?? {}, query: {}, file: opts.file },
      res,
      vi.fn(),
    );
    return { err: null, res };
  } catch (e) {
    return { err: e as { status?: number }, res };
  }
}

beforeEach(() => {
  mock.canSend = true;
  for (const k of Object.keys(mock.rows)) delete mock.rows[k];
  mock.inserts.length = 0;
  mock.updates.length = 0;
  mock.deletes.length = 0;
  mock.filters.length = 0;
  mock.storageUploaded.length = 0;
  mock.storageRemoved.length = 0;
  vi.mocked(canMessageUser).mockImplementation(async () => mock.canSend);
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ALICE = { id: 'u-alice', role: 'MANAGER', email: 'alice@test.local' };
const BOB_ID = '00000000-0000-0000-0000-000000000002';
const EVE_ID = '00000000-0000-0000-0000-0000000000ee';
const ATT_A = '00000000-0000-0000-0000-00000000aaaa';
const ATT_B = '00000000-0000-0000-0000-00000000bbbb';

// ---------------------------------------------------------------------------
// upload()
// ---------------------------------------------------------------------------

describe('messageAttachments.upload — IDOR gated by canMessageUser', () => {
  function mkFile() {
    return {
      originalname: 'doc.pdf',
      buffer: Buffer.from([0x25, 0x50, 0x44, 0x46]),
      mimetype: 'application/pdf',
    };
  }

  beforeEach(() => {
    mock.rows.users = [{ id: BOB_ID, is_active: true }];
    mock.rows.message_attachments = [
      {
        id: ATT_A,
        storage_path: 'pending/u-alice/123-doc.pdf',
        uploaded_by: ALICE.id,
        recipient_user_id: BOB_ID,
        message_id: null,
        file_name: 'doc.pdf',
      },
    ];
  });

  it('returns 403 and writes NOTHING to storage / DB when canMessageUser denies', async () => {
    mock.canSend = false;
    const { err } = await call(attachments.upload as Handler, ALICE, {
      body: { recipient_id: BOB_ID },
      file: mkFile(),
    });
    expect(err?.status).toBe(403);
    expect(mock.storageUploaded).toHaveLength(0);
    expect(mock.inserts.filter((i) => i.table === 'message_attachments')).toHaveLength(0);
  });

  it('returns 400 when targeting self even if canMessageUser would allow', async () => {
    mock.canSend = true;
    const { err } = await call(attachments.upload as Handler, ALICE, {
      body: { recipient_id: ALICE.id },
      file: mkFile(),
    });
    expect(err?.status).toBe(400);
    expect(mock.storageUploaded).toHaveLength(0);
  });

  it('returns 401 when unauthenticated', async () => {
    const { err } = await call(attachments.upload as Handler, undefined, {
      body: { recipient_id: BOB_ID },
      file: mkFile(),
    });
    expect(err?.status).toBe(401);
  });

  it('returns 404 when recipient does not exist (no storage write either)', async () => {
    mock.rows.users = [];
    const { err } = await call(attachments.upload as Handler, ALICE, {
      body: { recipient_id: BOB_ID },
      file: mkFile(),
    });
    expect(err?.status).toBe(404);
    expect(mock.storageUploaded).toHaveLength(0);
  });

  it('returns 400 when recipient is inactive', async () => {
    mock.rows.users = [{ id: BOB_ID, is_active: false }];
    const { err } = await call(attachments.upload as Handler, ALICE, {
      body: { recipient_id: BOB_ID },
      file: mkFile(),
    });
    expect(err?.status).toBe(400);
    expect(mock.storageUploaded).toHaveLength(0);
  });

  it('returns 400 when no file is attached', async () => {
    const { err } = await call(attachments.upload as Handler, ALICE, {
      body: { recipient_id: BOB_ID },
      // file omitted
    });
    expect(err?.status).toBe(400);
  });

  it('writes uploaded_by from req.user (cannot be spoofed via body)', async () => {
    mock.canSend = true;
    const { err } = await call(attachments.upload as Handler, ALICE, {
      body: { recipient_id: BOB_ID, uploaded_by: EVE_ID },
      file: mkFile(),
    });
    expect(err).toBeNull();
    const insert = mock.inserts.find((i) => i.table === 'message_attachments');
    expect(insert?.payload.uploaded_by).toBe(ALICE.id);
    expect(insert?.payload.uploaded_by).not.toBe(EVE_ID);
    // The storage path is also keyed by ALICE — proving the controller
    // didn't lift any value out of the body.
    expect(mock.storageUploaded[0]).toMatch(new RegExp(`^pending/${ALICE.id}/`));
  });
});

// ---------------------------------------------------------------------------
// claimAttachmentsForMessage()
// ---------------------------------------------------------------------------

describe('claimAttachmentsForMessage — silently drops cross-user / cross-recipient ids', () => {
  it('chains all three security filters: uploaded_by, recipient_user_id, message_id IS NULL', async () => {
    mock.rows.message_attachments = []; // update returns no rows
    await attachments.claimAttachmentsForMessage({
      attachmentIds: [ATT_A, ATT_B],
      messageId: 'm-1',
      senderId: ALICE.id,
      recipientId: BOB_ID,
    });
    const f = mock.filters.filter((x) => x.table === 'message_attachments');
    // .in('id', [...])
    expect(f.some((x) => x.method === 'in' && x.args[0] === 'id')).toBe(true);
    // .eq('uploaded_by', senderId)
    expect(
      f.some((x) => x.method === 'eq' && x.args[0] === 'uploaded_by' && x.args[1] === ALICE.id),
    ).toBe(true);
    // .eq('recipient_user_id', recipientId)
    expect(
      f.some((x) => x.method === 'eq' && x.args[0] === 'recipient_user_id' && x.args[1] === BOB_ID),
    ).toBe(true);
    // .is('message_id', null)
    expect(
      f.some((x) => x.method === 'is' && x.args[0] === 'message_id' && x.args[1] === null),
    ).toBe(true);
  });

  it('returns [] for an empty / nonsense input list without hitting the DB', async () => {
    const out = await attachments.claimAttachmentsForMessage({
      attachmentIds: [],
      messageId: 'm-1',
      senderId: ALICE.id,
      recipientId: BOB_ID,
    });
    expect(out).toEqual([]);
    expect(mock.updates).toHaveLength(0);
  });

  it('strips non-string ids before chaining .in() so a forged null does not match-all', async () => {
    const out = await attachments.claimAttachmentsForMessage({
      // mix of null / number / empty string — none of these are real
      // attachment ids; helper should drop them and treat the list as empty.
      attachmentIds: [null as unknown as string, '' as string, 0 as unknown as string],
      messageId: 'm-1',
      senderId: ALICE.id,
      recipientId: BOB_ID,
    });
    expect(out).toEqual([]);
    expect(mock.updates).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// remove()
// ---------------------------------------------------------------------------

describe('messageAttachments.remove — uploader-only', () => {
  it('returns 404 when the caller is NOT the uploader', async () => {
    // Row exists, but uploaded_by is someone else.
    mock.rows.message_attachments = [
      {
        id: ATT_A,
        uploaded_by: EVE_ID, // not Alice
        storage_path: 'pending/u-eve/x.pdf',
      },
    ];
    const { err } = await call(attachments.remove as Handler, ALICE, {
      params: { id: ATT_A },
    });
    // 404 (not 403) — keeps the endpoint from leaking attachment existence.
    expect(err?.status).toBe(404);
    expect(mock.deletes).toHaveLength(0);
    expect(mock.storageRemoved).toHaveLength(0);
  });

  it('returns 404 when the attachment row does not exist at all', async () => {
    mock.rows.message_attachments = [];
    const { err } = await call(attachments.remove as Handler, ALICE, {
      params: { id: ATT_A },
    });
    expect(err?.status).toBe(404);
  });

  it('deletes storage object + DB row when the caller IS the uploader', async () => {
    mock.rows.message_attachments = [
      {
        id: ATT_A,
        uploaded_by: ALICE.id,
        storage_path: 'pending/u-alice/x.pdf',
      },
    ];
    const { err, res } = await call(attachments.remove as Handler, ALICE, {
      params: { id: ATT_A },
    });
    expect(err).toBeNull();
    expect(res.body).toMatchObject({ ok: true });
    expect(mock.storageRemoved).toContain('pending/u-alice/x.pdf');
    expect(mock.deletes.some((d) => d.table === 'message_attachments')).toBe(true);
  });

  it('returns 401 when unauthenticated', async () => {
    const { err } = await call(attachments.remove as Handler, undefined, {
      params: { id: ATT_A },
    });
    expect(err?.status).toBe(401);
  });
});
