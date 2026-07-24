/**
 * Guard test for GET /applications/mine — the consultant-safe self-read added
 * so the consultant dashboard can show its own submissions without reaching the
 * OPERATOR_TIER operator list (which exposes recruiter-side fields). Asserts:
 *   1. a caller with no consultants row gets [] (never queries applications),
 *   2. the read self-scopes to the caller's own consultant_id, and
 *   3. the projection omits recruiter-side fields (recruiter_id / ats_score /
 *      the recruiter embed / `*`) while keeping the consultant-facing columns.
 *
 * The operator routes (GET /, create, update, events, …) stay OPERATOR_TIER via
 * the declarative requireRole gate in applications.routes.ts, unchanged.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  consultantRow: null as { id: string } | null,
  appSelect: '' as string,
  appEqs: [] as Array<[string, unknown]>,
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
      eq(col: string, val: unknown) {
        if (table === 'applications') mock.appEqs.push([col, val]);
        return b;
      },
      order: () => b,
      // getCallerConsultantRowId → from('consultants').select('id').eq().maybeSingle()
      maybeSingle: () =>
        Promise.resolve({ data: table === 'consultants' ? mock.consultantRow : null, error: null }),
      // listMine awaits the query directly after .order()
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: mock.appRows, error: null }).then(resolve),
    });
    return b;
  }
  return { db: { from: (t: string) => builder(t) }, pool: {} };
});
vi.mock('../services/ai.service', () => ({ atsScore: vi.fn() }));

import { listMine } from './applications.controller';

const CONSULTANT = { id: 'u-c', role: 'CONSULTANT', email: 'c@x.test' };

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
  mock.consultantRow = null;
  mock.appSelect = '';
  mock.appEqs = [];
  mock.appRows = [];
});

describe('applications.listMine — consultant-safe self-read', () => {
  it('returns [] and never queries applications when the caller has no consultant row', async () => {
    mock.consultantRow = null;
    const res = mkRes();
    await (listMine as any)({ user: CONSULTANT }, res, vi.fn());
    expect(res.body).toEqual([]);
    expect(mock.appSelect).toBe('');
  });

  it('self-scopes to the caller consultant row and selects a recruiter-safe projection', async () => {
    mock.consultantRow = { id: 'cons-1' };
    mock.appRows = [{ id: 'a1', status: 'OFFER', submitted_at: '2026-01-01' }];
    const res = mkRes();
    await (listMine as any)({ user: CONSULTANT }, res, vi.fn());

    expect(res.body).toEqual(mock.appRows);
    // scoped to the caller's OWN consultant id
    expect(mock.appEqs).toContainEqual(['consultant_id', 'cons-1']);
    // projection must NOT leak recruiter-side context
    expect(mock.appSelect).not.toContain('recruiter_id');
    expect(mock.appSelect).not.toContain('ats_score');
    expect(mock.appSelect).not.toContain('*');
    // but DOES include the consultant-facing fields the dashboard renders
    expect(mock.appSelect).toContain('status');
    expect(mock.appSelect).toContain('submitted_at');
    expect(mock.appSelect).toContain('job:jobs');
    expect(mock.appSelect).toContain('vendor:vendors');
  });
});
