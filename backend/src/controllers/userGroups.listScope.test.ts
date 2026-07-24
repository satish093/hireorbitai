/**
 * GET /user-groups scoping.
 *
 * The list backs org-wide selectors for operators, but a member of a group
 * (any role, incl. CONSULTANT) must be able to see THEIR OWN group so the
 * uploaded company logo renders for them. The route is now open to any
 * authenticated user; the controller scopes:
 *
 *   OPERATOR_TIER+ (admin, group leads, recruiter)  → every group
 *   DEVELOPER granted `user_groups`                 → every group
 *   everyone else (CONSULTANT, DEVELOPER no-cap)     → only their own group
 *   groupless non-operator                           → empty list
 *
 * DB + storage mocked at module load (no Postgres / env), per the rank-test pattern.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  userGroups: [] as Record<string, unknown>[],
  users: [] as Record<string, unknown>[],
}));

vi.mock('../config/db', () => {
  function builder(table: string) {
    const filters: Array<(r: Record<string, unknown>) => boolean> = [];
    const b: Record<string, unknown> = {};
    Object.assign(b, {
      select: () => b,
      order: () => b,
      eq: (col: string, v: unknown) => {
        filters.push((r) => r[col] === v);
        return b;
      },
      not: (col: string, op: string, v: unknown) => {
        if (op === 'is' && v === null) filters.push((r) => r[col] != null);
        return b;
      },
      then: (resolve: (x: unknown) => unknown) => {
        const src = table === 'user_groups' ? mock.userGroups : mock.users;
        const data = src.filter((r) => filters.every((f) => f(r)));
        return Promise.resolve({ data, error: null, count: data.length }).then(resolve);
      },
    });
    return b;
  }
  const storageBucket = {
    createSignedUrl: (path: string) =>
      Promise.resolve({ data: { signedUrl: `https://app.test/${path}` }, error: null }),
  };
  return {
    db: { from: (t: string) => builder(t), storage: { from: () => storageBucket } },
    pool: {},
  };
});

vi.mock('../config/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../services/audit.service', () => ({ audit: vi.fn() }));

import { list } from './userGroups.controller';

const GROUP_A = '00000000-0000-4000-8000-00000000000a';
const GROUP_B = '00000000-0000-4000-8000-00000000000b';

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

async function call(user: any): Promise<any[]> {
  const res = mkRes();
  await list({ user, query: {}, params: {} } as any, res, vi.fn());
  return res.body as any[];
}

beforeEach(() => {
  mock.userGroups = [
    { id: GROUP_A, name: 'Acme', logo_path: 'group-logos/a/logo.png' },
    { id: GROUP_B, name: 'Beta', logo_path: 'group-logos/b/logo.png' },
  ];
  mock.users = [{ group_id: GROUP_A }, { group_id: GROUP_A }, { group_id: GROUP_B }];
});

describe('userGroups.list — caller scoping', () => {
  it('OPERATOR_TIER (RECRUITER) sees every group', async () => {
    const body = await call({ id: 'u1', role: 'RECRUITER', group_id: GROUP_A });
    expect(body.map((g) => g.id).sort()).toEqual([GROUP_A, GROUP_B].sort());
  });

  it('a group lead (MANAGER) sees every group', async () => {
    const body = await call({ id: 'u2', role: 'MANAGER', group_id: GROUP_A });
    expect(body).toHaveLength(2);
  });

  it('a CONSULTANT sees ONLY their own group — with the signed logo_url', async () => {
    const body = await call({ id: 'u3', role: 'CONSULTANT', group_id: GROUP_B });
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe(GROUP_B);
    expect(body[0].logo_url).toBe('https://app.test/group-logos/b/logo.png');
  });

  it('a groupless CONSULTANT gets an empty list', async () => {
    const body = await call({ id: 'u4', role: 'CONSULTANT', group_id: null });
    expect(body).toEqual([]);
  });

  it('a DEVELOPER WITHOUT user_groups is scoped to its own group', async () => {
    const body = await call({ id: 'u5', role: 'DEVELOPER', group_id: GROUP_A, capabilities: [] });
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe(GROUP_A);
  });

  it('a DEVELOPER granted user_groups sees every group', async () => {
    const body = await call({
      id: 'u6',
      role: 'DEVELOPER',
      group_id: GROUP_A,
      capabilities: ['user_groups'],
    });
    expect(body).toHaveLength(2);
  });
});
