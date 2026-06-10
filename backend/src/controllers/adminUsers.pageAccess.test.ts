/**
 * PATCH /admin/users/:id/page-access — setPageAccess.
 *
 * Grants/revokes PAGE-ACCESS capabilities (e.g. 'invoices') for ANY user, of
 * any role. Distinct from setCapabilities (SUPER_ADMIN-only, DEVELOPER-only
 * targets, the powerful admin catalog): this is ADMIN_TIER and carries no admin
 * power, so a DIRECTOR may grant it to a RECRUITER / CONSULTANT.
 *
 * Invariants pinned here:
 *   - ADMIN_TIER required; a DEVELOPER holding `users` (which the router admits)
 *     is rejected at the handler — handing out page access is admin-only.
 *   - Body is .strict() + z.enum(PAGE_ACCESS_CAPABILITIES): an admin cap like
 *     'users' or an unknown key is a 400, never silently written.
 *   - The merge preserves the target's existing NON-page (DEVELOPER) caps.
 *
 * DB is mocked at module load — no Postgres / env, per adminUsers.developerMove.
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
    } = { mode: 'select', filters: {} };
    const b: Record<string, unknown> = {};
    Object.assign(b, {
      select() {
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
  return { db: { from: (table: string) => makeBuilder(table) }, pool: {} };
});
vi.mock('../services/audit.service', () => ({ audit: vi.fn() }));
vi.mock('../services/auth.service', () => ({ requestPasswordReset: vi.fn() }));
vi.mock('../config/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { setPageAccess } from './adminUsers.controller';
import { audit } from '../services/audit.service';

const TARGET = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function mkRes() {
  const r: any = {
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
  return r;
}

async function call(actor: any, body: any): Promise<{ err: any; res: any }> {
  const res = mkRes();
  try {
    await (setPageAccess as any)({ user: actor, params: { id: TARGET }, body }, res, vi.fn());
    return { err: null, res };
  } catch (e) {
    return { err: e as { status?: number }, res };
  }
}

beforeEach(() => {
  for (const k of Object.keys(mock.users)) delete mock.users[k];
  mock.updates.length = 0;
  vi.mocked(audit).mockClear();
});

describe('setPageAccess — authorization', () => {
  beforeEach(() => {
    mock.users[TARGET] = { id: TARGET, email: 'rec@x.test', role: 'RECRUITER', capabilities: [] };
  });

  it('401 when unauthenticated', async () => {
    const { err } = await call(undefined, { capabilities: ['invoices'] });
    expect(err?.status).toBe(401);
    expect(mock.updates.length).toBe(0);
  });

  it('403 for a non-ADMIN_TIER actor (MANAGER)', async () => {
    const { err } = await call({ id: 'm', role: 'MANAGER' }, { capabilities: ['invoices'] });
    expect(err?.status).toBe(403);
    expect(mock.updates.length).toBe(0);
  });

  it('403 for a DEVELOPER holding `users` — page access is admin-only', async () => {
    const { err } = await call(
      { id: 'd', role: 'DEVELOPER', capabilities: ['users'] },
      { capabilities: ['invoices'] },
    );
    expect(err?.status).toBe(403);
    expect(mock.updates.length).toBe(0);
  });

  it('admits a DIRECTOR (ADMIN_TIER below SUPER_ADMIN)', async () => {
    const { err } = await call({ id: 'dir', role: 'DIRECTOR' }, { capabilities: ['invoices'] });
    expect(err).toBeNull();
    expect(mock.updates.length).toBe(1);
  });
});

describe('setPageAccess — validation', () => {
  beforeEach(() => {
    mock.users[TARGET] = { id: TARGET, email: 'rec@x.test', role: 'RECRUITER', capabilities: [] };
  });

  it('400 when a DEVELOPER admin cap (users) is submitted', async () => {
    const { err } = await call({ id: 'a', role: 'SUPER_ADMIN' }, { capabilities: ['users'] });
    expect(err?.status).toBe(400);
    expect(mock.updates.length).toBe(0);
  });

  it('400 on an unknown/extra key (.strict())', async () => {
    const { err } = await call(
      { id: 'a', role: 'SUPER_ADMIN' },
      { capabilities: ['invoices'], role: 'CEO' },
    );
    expect(err?.status).toBe(400);
    expect(mock.updates.length).toBe(0);
  });

  it('404 when the target user does not exist', async () => {
    delete mock.users[TARGET];
    const { err } = await call({ id: 'a', role: 'SUPER_ADMIN' }, { capabilities: ['invoices'] });
    expect(err?.status).toBe(404);
    expect(mock.updates.length).toBe(0);
  });
});

describe('setPageAccess — merge semantics', () => {
  it('grants invoices to a RECRUITER with no prior caps + audits', async () => {
    mock.users[TARGET] = { id: TARGET, email: 'rec@x.test', role: 'RECRUITER', capabilities: [] };
    const { err, res } = await call({ id: 'a', role: 'CEO' }, { capabilities: ['invoices'] });
    expect(err).toBeNull();
    expect(mock.updates[0].patch.capabilities).toEqual(['invoices']);
    expect(res.body).toEqual({ ok: true, capabilities: ['invoices'] });
    expect(vi.mocked(audit)).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'user_page_access_set' }),
    );
  });

  it('preserves the target DEVELOPER’s existing admin caps when adding invoices', async () => {
    mock.users[TARGET] = {
      id: TARGET,
      email: 'dev@x.test',
      role: 'DEVELOPER',
      capabilities: ['users', 'feature_flags'],
    };
    const { err } = await call({ id: 'a', role: 'SUPER_ADMIN' }, { capabilities: ['invoices'] });
    expect(err).toBeNull();
    const caps = mock.updates[0].patch.capabilities as string[];
    expect(caps).toContain('users');
    expect(caps).toContain('feature_flags');
    expect(caps).toContain('invoices');
    expect(caps).toHaveLength(3);
  });

  it('revoking (empty array) clears page caps but keeps non-page caps', async () => {
    mock.users[TARGET] = {
      id: TARGET,
      email: 'dev@x.test',
      role: 'DEVELOPER',
      capabilities: ['users', 'invoices'],
    };
    const { err } = await call({ id: 'a', role: 'SUPER_ADMIN' }, { capabilities: [] });
    expect(err).toBeNull();
    expect(mock.updates[0].patch.capabilities).toEqual(['users']);
  });
});
