/**
 * Regression: DEVELOPER accounts may only be moved between groups (or out of
 * a group entirely) by a SUPER_ADMIN. Rank checks alone would let a CEO /
 * CTO / Director shuffle a Developer, which contradicts the "Developer can
 * never be moved by anyone except a Super Admin" rule in
 * docs/rbac-overview.html. Two surfaces enforce this:
 *
 *   PATCH /admin/users/:id/group     → setGroup
 *   POST  /admin/users/bulk          → bulk (action: 'move-group')
 *
 * Both must reject every non-SUPER_ADMIN actor when the target is a Developer.
 * DB is mocked at module load — no Postgres / env required.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mock = vi.hoisted(() => {
  const users: Record<string, Record<string, unknown>> = {};
  const updates: Array<{ id: string; patch: Record<string, unknown> }> = [];
  return { users, updates };
});

vi.mock('../config/db', () => {
  function makeBuilder(table: string) {
    const state: {
      mode: 'select' | 'update';
      filters: Record<string, unknown>;
      patch?: Record<string, unknown>;
      selectCols?: string;
    } = { mode: 'select', filters: {} };
    const b: Record<string, unknown> = {};
    Object.assign(b, {
      select(cols?: string) {
        state.selectCols = cols;
        return b;
      },
      update(patch: Record<string, unknown>) {
        state.mode = 'update';
        state.patch = patch;
        return b;
      },
      eq(col: string, value: unknown) {
        state.filters[col] = value;
        return b;
      },
      maybeSingle() {
        if (table !== 'users') return Promise.resolve({ data: null, error: null });
        const id = state.filters.id as string | undefined;
        const row = id ? mock.users[id] : null;
        return Promise.resolve({ data: row ?? null, error: null });
      },
      single() {
        if (state.mode === 'update' && table === 'users') {
          const id = state.filters.id as string;
          mock.updates.push({ id, patch: state.patch ?? {} });
          const row = { ...(mock.users[id] ?? {}), ...(state.patch ?? {}), id };
          return Promise.resolve({ data: row, error: null });
        }
        const id = state.filters.id as string | undefined;
        return Promise.resolve({ data: id ? (mock.users[id] ?? null) : null, error: null });
      },
      then<T>(resolve: (v: unknown) => T) {
        if (state.mode === 'update' && table === 'users') {
          const id = state.filters.id as string;
          mock.updates.push({ id, patch: state.patch ?? {} });
          return Promise.resolve({ data: null, error: null }).then(resolve);
        }
        return Promise.resolve({ data: [], error: null, count: 0 }).then(resolve);
      },
    });
    return b;
  }
  return {
    db: {
      from: (table: string) => makeBuilder(table),
      auth: { admin: { signOut: vi.fn(() => Promise.resolve()) } },
    },
    pool: {},
  };
});
vi.mock('../services/audit.service', () => ({ audit: vi.fn() }));
vi.mock('../services/auth.service', () => ({ requestPasswordReset: vi.fn() }));
vi.mock('../config/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { setGroup, bulk } from './adminUsers.controller';

function mkRes() {
  const r: {
    statusCode: number;
    body: unknown;
    status: (c: number) => unknown;
    json: (b: unknown) => unknown;
  } = {
    statusCode: 200,
    body: undefined,
    status(c: number) {
      r.statusCode = c;
      return r;
    },
    json(b: unknown) {
      r.body = b;
      return r;
    },
  };
  return r as any;
}

beforeEach(() => {
  for (const k of Object.keys(mock.users)) delete mock.users[k];
  mock.updates.length = 0;
});

// ─── setGroup ───────────────────────────────────────────────────────────────
describe('PATCH /admin/users/:id/group — DEVELOPER targets are SUPER_ADMIN-only', () => {
  beforeEach(() => {
    mock.users['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'] = {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      email: 'dev@example.test',
      role: 'DEVELOPER',
      group_id: null,
    };
  });

  async function call(actorRole: string) {
    const res = mkRes();
    try {
      await (setGroup as any)(
        {
          user: { id: 'actor', role: actorRole },
          params: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
          body: { group_id: '11111111-1111-1111-1111-111111111111' },
        },
        res,
        vi.fn(),
      );
      return { err: null, res };
    } catch (e) {
      return { err: e as { status?: number; message?: string }, res };
    }
  }

  it('allows SUPER_ADMIN to move a Developer', async () => {
    const { err } = await call('SUPER_ADMIN');
    expect(err).toBeNull();
    expect(mock.updates.length).toBe(1);
  });

  it('rejects CEO with 403 (NOT 404, so the message is informative)', async () => {
    const { err } = await call('CEO');
    expect(err?.status).toBe(403);
    // No DB update should have happened.
    expect(mock.updates.length).toBe(0);
  });

  it('rejects CTO with 403', async () => {
    const { err } = await call('CTO');
    expect(err?.status).toBe(403);
    expect(mock.updates.length).toBe(0);
  });

  it('rejects DIRECTOR with 403', async () => {
    const { err } = await call('DIRECTOR');
    expect(err?.status).toBe(403);
    expect(mock.updates.length).toBe(0);
  });

  it('rejects a non-admin (HR_MANAGER) at the rank check before reaching the Developer guard', async () => {
    // HR_MANAGER doesn't outrank DEVELOPER (it does by ROLE_RANK numerically,
    // but assertOutranks compares ranks — the Developer guard is the safety
    // net AFTER the rank check passes). Either way the request is denied.
    const { err } = await call('HR_MANAGER');
    expect(err?.status).toBe(403);
    expect(mock.updates.length).toBe(0);
  });

  it('does NOT block CEO from moving a NON-Developer (regression — only Developers are SA-only)', async () => {
    mock.users['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'] = {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      email: 'r@x.test',
      role: 'RECRUITER',
      group_id: null,
    };
    const res = mkRes();
    let err: { status?: number } | null = null;
    try {
      await (setGroup as any)(
        {
          user: { id: 'actor', role: 'CEO' },
          params: { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
          body: { group_id: '11111111-1111-1111-1111-111111111111' },
        },
        res,
        vi.fn(),
      );
    } catch (e) {
      err = e as { status?: number };
    }
    expect(err).toBeNull();
    expect(mock.updates.length).toBe(1);
  });
});

// ─── bulk move-group ───────────────────────────────────────────────────────
describe('POST /admin/users/bulk action="move-group" — DEVELOPER targets are SUPER_ADMIN-only', () => {
  beforeEach(() => {
    mock.users['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'] = {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      email: 'dev@example.test',
      role: 'DEVELOPER',
      status: null,
    };
    mock.users['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'] = {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      email: 'r@x.test',
      role: 'RECRUITER',
      status: null,
    };
  });

  async function callBulk(actorRole: string, ids: string[]) {
    const res = mkRes();
    await (bulk as any)(
      {
        user: { id: 'actor', role: actorRole },
        body: {
          ids,
          action: 'move-group',
          payload: { group_id: '11111111-1111-1111-1111-111111111111' },
        },
      },
      res,
      vi.fn(),
    );
    return res;
  }

  it('CEO bulk-move that includes a Developer: the Developer row fails, others succeed', async () => {
    const res = await callBulk('CEO', [
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    ]);
    const results = (res.body as { results: { id: string; ok: boolean; error?: string }[] })
      .results;
    const dev = results.find((r) => r.id === 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')!;
    const rec = results.find((r) => r.id === 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')!;
    expect(dev.ok).toBe(false);
    expect(dev.error).toMatch(/Super Admin/i);
    expect(rec.ok).toBe(true);
    // Only the recruiter row got updated.
    expect(mock.updates.length).toBe(1);
    expect(mock.updates[0].id).toBe('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  });

  it('SUPER_ADMIN bulk-move that includes a Developer: BOTH succeed', async () => {
    const res = await callBulk('SUPER_ADMIN', [
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    ]);
    const results = (res.body as { results: { id: string; ok: boolean }[] }).results;
    expect(results.every((r) => r.ok)).toBe(true);
    expect(mock.updates.length).toBe(2);
  });
});
