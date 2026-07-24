/**
 * Regression test for GET /applications (operator list). The Applications table
 * renders `a.consultant.user.full_name` and `a.recruiter.user.full_name`, so the
 * list query MUST embed each side's `user` row. Previously the select was
 * `consultant:consultants(*)` (no name — names live on `users`) with no recruiter
 * embed at all, so both the Consultant and Recruiter columns rendered "—".
 *
 * This list stays OPERATOR_TIER-gated (consultants use /applications/mine), so
 * embedding recruiter context here is intentional and safe.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  appSelect: '' as string,
  appRows: [] as unknown[],
}));

vi.mock('../config/db', () => {
  function builder(table: string) {
    const b: Record<string, unknown> = {};
    Object.assign(b, {
      select(s: string) {
        if (table === 'applications') mock.appSelect = s;
        return b;
      },
      eq: () => b,
      in: () => b,
      // list awaits qb.order(...) as the terminal call
      order: () => Promise.resolve({ data: mock.appRows, error: null }),
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
    });
    return b;
  }
  return { db: { from: (t: string) => builder(t) }, pool: {} };
});
vi.mock('../services/ai.service', () => ({ atsScore: vi.fn() }));
vi.mock('../services/groupScope', () => ({
  managerGroupConsultantIds: vi.fn().mockResolvedValue(null), // admin tier = unscoped
  isAdminTier: () => true,
  isGroupLead: () => false,
  leadCanAccessConsultant: vi.fn(),
  assertCanAccessConsultant: vi.fn(),
}));

import { list } from './applications.controller';

const ADMIN = { id: 'u-a', role: 'SUPER_ADMIN', email: 'a@x.test' };

function mkRes() {
  const res: any = {
    body: undefined,
    json(b: unknown) {
      this.body = b;
      return this;
    },
  };
  return res;
}

beforeEach(() => {
  mock.appSelect = '';
  mock.appRows = [{ id: 'a1' }];
});

describe('applications.list — embeds consultant + recruiter names', () => {
  it('embeds consultant.user and recruiter.user so the table can render names', async () => {
    const res = mkRes();
    await (list as any)({ user: ADMIN, query: {} }, res, vi.fn());

    expect(res.body).toEqual(mock.appRows);
    // both sides embedded…
    expect(mock.appSelect).toContain('consultant:consultants(');
    expect(mock.appSelect).toContain('recruiter:recruiters(');
    // …and each pulls the user row where the name lives (one per embed)
    expect(mock.appSelect.match(/user:users/g)?.length).toBe(2);
  });
});
