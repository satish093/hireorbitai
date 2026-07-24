/**
 * Regression test for the PostgREST control-char escape in adminUsers.list.
 *
 * Before the fix, the search-string sanitizer only escaped `%` and `_`
 * (LIKE wildcards). PostgREST `.or()` strings also use `,` `.` `(` `)`
 * `*` as control chars — an unsanitized comma would terminate the
 * current filter clause and let a scoped DEVELOPER (with `users`
 * capability) inject a `role.eq.SUPER_ADMIN` clause, widening the result
 * set past their intended scope.
 *
 * This test pins that every PostgREST control char appears escaped
 * (backslash-prefixed) inside the .or() expression the controller hands
 * to the DB shim.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mock = vi.hoisted(() => ({
  lastOr: null as string | null,
}));

vi.mock('../config/db', () => {
  function makeBuilder() {
    const b: Record<string, unknown> = {};
    Object.assign(b, {
      select: () => b,
      eq: () => b,
      gte: () => b,
      lt: () => b,
      in: () => b,
      ilike: () => b,
      or(expr: string) {
        mock.lastOr = expr;
        return b;
      },
      order: () => b,
      range: () => b,
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: [], count: 0, error: null }).then(resolve),
    });
    return b;
  }
  return {
    db: { from: () => makeBuilder() },
    pool: { query: vi.fn(async () => ({ rows: [] })) },
  };
});

vi.mock('../services/audit.service', () => ({ audit: vi.fn() }));
vi.mock('../services/auth.service', () => ({ requestPasswordReset: vi.fn() }));
vi.mock('../config/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import * as adminUsers from './adminUsers.controller';

beforeEach(() => {
  mock.lastOr = null;
});

function mkRes() {
  const res: {
    statusCode: number;
    body: unknown;
    status: (c: number) => any;
    json: (b: unknown) => any;
  } = {
    statusCode: 200,
    body: undefined,
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(b) {
      this.body = b;
      return this;
    },
  };
  return res;
}

async function callList(query: Record<string, string>) {
  const res = mkRes();
  await (adminUsers.list as any)(
    {
      user: { id: 'u-admin', role: 'SUPER_ADMIN', email: 'admin@x.test' },
      query,
      body: {},
      params: {},
    },
    res,
    vi.fn(),
  );
  return res;
}

describe('adminUsers.list — PostgREST control-char escape', () => {
  it('escapes the LIKE wildcards % and _ in the search input', async () => {
    await callList({ q: 'foo%bar_baz' });
    expect(mock.lastOr).toContain('\\%');
    expect(mock.lastOr).toContain('\\_');
  });

  it('escapes PostgREST control chars , . ( ) * — comma is the injection vector', async () => {
    await callList({ q: ',role.eq.SUPER_ADMIN' });
    // Every PostgREST control char in the input must be backslash-prefixed
    // in the resulting .or() string. The comma is the worst — unescaped,
    // it would terminate the current filter clause and add a new one.
    expect(mock.lastOr).not.toContain(',role.eq.SUPER_ADMIN');
    expect(mock.lastOr).toContain('\\,');
    expect(mock.lastOr).toContain('\\.');
  });

  it('escapes parentheses and asterisks (PostgREST grouping / wildcard)', async () => {
    await callList({ q: 'a(b)c*' });
    expect(mock.lastOr).toContain('\\(');
    expect(mock.lastOr).toContain('\\)');
    expect(mock.lastOr).toContain('\\*');
  });

  it('still produces a usable filter for a plain search', async () => {
    await callList({ q: 'alice' });
    expect(mock.lastOr).toMatch(/email\.ilike\.%alice%/);
    expect(mock.lastOr).toMatch(/full_name\.ilike\.%alice%/);
  });
});
