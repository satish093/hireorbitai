/**
 * Submissions reports — grouped counts + filters + scoping.
 *
 * Covers (Phase 13):
 *   - grouped submission counts by consultant
 *   - grouped submission counts by recruiter
 *   - per-status breakdown + derived interviews/offers/rejections
 *   - daily / weekly / monthly period → range window
 *   - explicit from/to date filter excludes out-of-range submissions
 *   - GROUP LEAD is group-scoped (fail-closed with no group)
 *   - RECRUITER sees only their own submissions
 *   - CONSULTANT (defensive) sees nothing (route gate also blocks)
 *
 * DB mocked at module load (no Postgres / env), per the permission.service pattern.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mock = vi.hoisted(() => {
  const rows: Record<string, Record<string, unknown>[]> = {};
  return { rows };
});

vi.mock('../config/db', () => {
  function builder(table: string) {
    const filters: Array<(r: Record<string, unknown>) => boolean> = [];
    const b: Record<string, unknown> = {};
    Object.assign(b, {
      select: () => b,
      eq: (col: string, v: unknown) => {
        filters.push((r) => r[col] === v);
        return b;
      },
      neq: (col: string, v: unknown) => {
        filters.push((r) => r[col] !== v);
        return b;
      },
      in: (col: string, vals: unknown[]) => {
        filters.push((r) => vals.includes(r[col]));
        return b;
      },
      gte: (col: string, v: unknown) => {
        filters.push((r) => r[col] != null && String(r[col]) >= String(v));
        return b;
      },
      lte: (col: string, v: unknown) => {
        filters.push((r) => r[col] != null && String(r[col]) <= String(v));
        return b;
      },
      order: () => b,
      apply() {
        return (mock.rows[table] ?? []).filter((r) => filters.every((f) => f(r)));
      },
      maybeSingle: () => Promise.resolve({ data: (b as any).apply()[0] ?? null, error: null }),
      single: () => Promise.resolve({ data: (b as any).apply()[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: (b as any).apply(), error: null }).then(resolve),
    });
    return b;
  }
  return { db: { from: (t: string) => builder(t) }, pool: {} };
});

import { submissionsByConsultant, submissionsByRecruiter } from './reports.controller';

function mkRes() {
  const r: any = { statusCode: 200, body: undefined };
  r.status = (c: number) => {
    r.statusCode = c;
    return r;
  };
  r.json = (b: unknown) => {
    r.body = b;
    return r;
  };
  return r;
}

async function call(handler: any, user: any, query: Record<string, unknown> = {}) {
  const res = mkRes();
  await handler({ user, query }, res, vi.fn());
  return res.body as any;
}

// ── Fixtures ────────────────────────────────────────────────────────────────
function app(
  id: string,
  consultant_id: string,
  recruiter_id: string,
  status: string,
  submitted_at: string,
  names: { c?: string; r?: string } = {},
) {
  return {
    id,
    consultant_id,
    recruiter_id,
    status,
    submitted_at,
    consultant: { user: { full_name: names.c ?? `Cons ${consultant_id}` } },
    recruiter: { user: { full_name: names.r ?? `Rec ${recruiter_id}` } },
  };
}

const ADMIN = { id: 'u-admin', role: 'DIRECTOR' as const };
const LEAD = { id: 'u-lead', role: 'HR_MANAGER' as const, group_id: 'g1' };
const RECRUITER = { id: 'u-rec', role: 'RECRUITER' as const };
const CONSULTANT = { id: 'u-cons', role: 'CONSULTANT' as const };

const IN_RANGE = '2026-03-15T10:00:00.000Z';
const FROM = '2026-03-01T00:00:00.000Z';
const TO = '2026-03-31T23:59:59.000Z';

beforeEach(() => {
  for (const k of Object.keys(mock.rows)) delete mock.rows[k];
});

describe('submissionsByConsultant', () => {
  it('groups submissions by consultant with status breakdown + derived metrics (admin)', async () => {
    mock.rows.applications = [
      app('a1', 'c1', 'r1', 'SUBMITTED', IN_RANGE),
      app('a2', 'c1', 'r1', 'INTERVIEW', IN_RANGE),
      app('a3', 'c1', 'r1', 'OFFER', IN_RANGE),
      app('a4', 'c2', 'r2', 'REJECTED', IN_RANGE),
    ];
    const body = await call(submissionsByConsultant, ADMIN, { from: FROM, to: TO });
    const c1 = body.consultants.find((x: any) => x.id === 'c1');
    const c2 = body.consultants.find((x: any) => x.id === 'c2');
    expect(c1.total).toBe(3);
    expect(c1.by_status.SUBMITTED).toBe(1);
    expect(c1.interviews).toBe(1);
    expect(c1.offers).toBe(1);
    expect(c2.total).toBe(1);
    expect(c2.rejections).toBe(1);
    // Sorted by total desc.
    expect(body.consultants[0].id).toBe('c1');
  });

  it('excludes submissions outside the from–to window', async () => {
    mock.rows.applications = [
      app('a1', 'c1', 'r1', 'SUBMITTED', IN_RANGE),
      app('a2', 'c1', 'r1', 'SUBMITTED', '2026-01-01T00:00:00.000Z'), // before window
    ];
    const body = await call(submissionsByConsultant, ADMIN, { from: FROM, to: TO });
    expect(body.consultants.find((x: any) => x.id === 'c1').total).toBe(1);
  });

  it('daily/weekly/monthly period sets a matching range window', async () => {
    mock.rows.applications = [];
    for (const [period, days] of [
      ['daily', 1],
      ['weekly', 7],
      ['monthly', 30],
    ] as const) {
      const body = await call(submissionsByConsultant, ADMIN, { period });
      const span = new Date(body.to).getTime() - new Date(body.from).getTime();
      expect(Math.round(span / 86400000)).toBe(days);
    }
  });

  it('GROUP LEAD sees only their group consultants; out-of-group excluded', async () => {
    // group g1 has user u-c1 → consultant c1; c2 is outside the group.
    mock.rows.users = [{ id: 'u-c1', group_id: 'g1' }];
    mock.rows.consultants = [{ id: 'c1', user_id: 'u-c1' }];
    mock.rows.applications = [
      app('a1', 'c1', 'r1', 'SUBMITTED', IN_RANGE),
      app('a2', 'c2', 'r2', 'SUBMITTED', IN_RANGE),
    ];
    const body = await call(submissionsByConsultant, LEAD, { from: FROM, to: TO });
    expect(body.consultants.map((x: any) => x.id)).toEqual(['c1']);
  });

  it('GROUP LEAD with no group sees nothing (fail-closed)', async () => {
    mock.rows.users = [];
    mock.rows.consultants = [];
    mock.rows.applications = [app('a1', 'c1', 'r1', 'SUBMITTED', IN_RANGE)];
    const body = await call(
      submissionsByConsultant,
      { ...LEAD, group_id: null },
      { from: FROM, to: TO },
    );
    expect(body.consultants).toEqual([]);
  });

  it('CONSULTANT (defensive) sees nothing', async () => {
    mock.rows.applications = [app('a1', 'c1', 'r1', 'SUBMITTED', IN_RANGE)];
    const body = await call(submissionsByConsultant, CONSULTANT, { from: FROM, to: TO });
    expect(body.consultants).toEqual([]);
  });
});

describe('submissionsByRecruiter', () => {
  it('groups submissions by recruiter (admin sees all)', async () => {
    mock.rows.applications = [
      app('a1', 'c1', 'r1', 'SUBMITTED', IN_RANGE),
      app('a2', 'c2', 'r1', 'INTERVIEW', IN_RANGE),
      app('a3', 'c3', 'r2', 'OFFER', IN_RANGE),
    ];
    const body = await call(submissionsByRecruiter, ADMIN, { from: FROM, to: TO });
    const r1 = body.recruiters.find((x: any) => x.id === 'r1');
    expect(r1.total).toBe(2);
    expect(r1.interviews).toBe(1);
    expect(body.recruiters.find((x: any) => x.id === 'r2').offers).toBe(1);
  });

  it('RECRUITER sees only their own submissions', async () => {
    mock.rows.recruiters = [{ id: 'r-mine', user_id: 'u-rec' }];
    mock.rows.applications = [
      app('a1', 'c1', 'r-mine', 'SUBMITTED', IN_RANGE),
      app('a2', 'c2', 'r-other', 'SUBMITTED', IN_RANGE),
    ];
    const body = await call(submissionsByRecruiter, RECRUITER, { from: FROM, to: TO });
    expect(body.recruiters.map((x: any) => x.id)).toEqual(['r-mine']);
    expect(body.recruiters[0].total).toBe(1);
  });

  it('RECRUITER with no recruiter row sees nothing', async () => {
    mock.rows.recruiters = [];
    mock.rows.applications = [app('a1', 'c1', 'r1', 'SUBMITTED', IN_RANGE)];
    const body = await call(submissionsByRecruiter, RECRUITER, { from: FROM, to: TO });
    expect(body.recruiters).toEqual([]);
  });
});
