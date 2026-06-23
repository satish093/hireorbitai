import { beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  target: {
    id: 'target',
    email: 'target@test',
    role: 'DEVELOPER',
    capabilities: ['users', 'invoices'],
  } as any,
  updated: null as any,
}));

vi.mock('../config/db', () => ({
  db: {
    from: () => {
      const builder: any = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: () => Promise.resolve({ data: mock.target, error: null }),
        update: (patch: any) => {
          mock.updated = patch;
          return builder;
        },
        then: (resolve: any) => Promise.resolve({ data: null, error: null }).then(resolve),
      };
      return builder;
    },
  },
  pool: {},
}));
vi.mock('../services/audit.service', () => ({ audit: vi.fn() }));

import { setPageAccess } from './adminUsers.controller';

async function call(user: any, body: any) {
  const res: any = {
    body: null,
    json(value: any) {
      this.body = value;
      return this;
    },
  };
  try {
    await setPageAccess({ user, body, params: { id: 'target' } } as any, res, vi.fn());
    return { res, error: null as any };
  } catch (error) {
    return { res, error: error as { status?: number } };
  }
}

beforeEach(() => {
  mock.updated = null;
  mock.target = {
    id: 'target',
    email: 'target@test',
    role: 'DEVELOPER',
    capabilities: ['users', 'invoices'],
  };
});

describe('removed invoice page access', () => {
  it('rejects attempts to grant the obsolete invoices capability', async () => {
    const { error } = await call(
      { id: 'admin', role: 'SUPER_ADMIN' },
      { capabilities: ['invoices'] },
    );
    expect(error?.status).toBe(400);
    expect(mock.updated).toBeNull();
  });

  it('an empty page-access update removes stale invoice grants and preserves admin grants', async () => {
    const { error, res } = await call({ id: 'admin', role: 'DIRECTOR' }, { capabilities: [] });
    expect(error).toBeNull();
    expect(mock.updated.capabilities).toEqual(['users']);
    expect(res.body.capabilities).toEqual(['users']);
  });

  it('remains admin-tier only', async () => {
    const { error } = await call({ id: 'manager', role: 'MANAGER' }, { capabilities: [] });
    expect(error?.status).toBe(403);
  });
});
