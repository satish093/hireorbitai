/**
 * Supplementary permission-engine tests focused on `canMessageUser` — the
 * single-target check used by the message send / thread-view controllers.
 *
 * permission.service.test.ts already covers getAccessibleUserIds() scopes and
 * the cache. This file pins the two behaviors specific to canMessageUser that
 * a controller leans on directly:
 *   - a non-manager caller is denied a target outside their relationship graph
 *     (the core IDOR guard for messaging),
 *   - the prior-thread fast path keeps an existing conversation reachable.
 *
 * DB mocked end-to-end, same strategy as the sibling test file.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mock = vi.hoisted(() => {
  const handlers: Map<string, (filters: Record<string, unknown>) => unknown[]> = new Map();
  return { handlers };
});

vi.mock('../config/db', () => {
  type R = { data: unknown; error: null; count?: number };
  function makeBuilder(table: string) {
    const filters: Record<string, unknown> = {};
    const builder = {
      select(_cols?: string, opts?: { count?: string; head?: boolean }) {
        filters.__head = !!opts?.head;
        return builder;
      },
      eq(col: string, value: unknown) {
        filters[`eq:${col}`] = value;
        return builder;
      },
      neq(col: string, value: unknown) {
        filters[`neq:${col}`] = value;
        return builder;
      },
      is(col: string, value: unknown) {
        filters[`is:${col}`] = value;
        return builder;
      },
      in(col: string, value: unknown[]) {
        filters[`in:${col}`] = value;
        return builder;
      },
      or(expr: string) {
        filters['or'] = expr;
        return builder;
      },
      maybeSingle() {
        const rows = mock.handlers.get(table)?.(filters) ?? [];
        return Promise.resolve({ data: rows[0] ?? null, error: null } as R);
      },
      single() {
        const rows = mock.handlers.get(table)?.(filters) ?? [];
        return Promise.resolve({ data: rows[0] ?? null, error: null } as R);
      },
      then<T>(resolve: (value: R) => T) {
        const rows = mock.handlers.get(table)?.(filters) ?? [];
        return Promise.resolve({
          data: filters.__head ? null : rows,
          error: null,
          count: rows.length,
        } as R).then(resolve);
      },
    };
    return builder;
  }
  return { db: { from: (table: string) => makeBuilder(table) }, pool: {} };
});

vi.mock('../config/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { canMessageUser, clearPermissionCache } from './permission.service';

function setupDb(rows: Record<string, unknown[]>) {
  mock.handlers.clear();
  for (const [table, list] of Object.entries(rows)) {
    mock.handlers.set(table, (filters) =>
      list.filter((row) => {
        const r = row as Record<string, unknown>;
        for (const [k, v] of Object.entries(filters)) {
          if (k.startsWith('eq:')) {
            if (r[k.slice(3)] !== v) return false;
          } else if (k.startsWith('neq:')) {
            if (r[k.slice(4)] === v) return false;
          } else if (k.startsWith('in:')) {
            if (!(v as unknown[]).includes(r[k.slice(3)])) return false;
          }
          // `or` is intentionally not applied — prior-thread tests supply the
          // exact message rows they want counted on the `messages` table.
        }
        return true;
      }),
    );
  }
}

beforeEach(() => {
  clearPermissionCache();
  mock.handlers.clear();
});

describe('canMessageUser — relationship scope', () => {
  it('lets a recruiter message their own assigned consultant', async () => {
    setupDb({
      recruiters: [{ id: 'r-mine', user_id: 'u-recruiter', manager_id: null }],
      recruiter_managers: [],
      consultants: [{ recruiter_id: 'r-mine', user_id: 'u-my-consultant' }],
      users: [{ id: 'u-recruiter', reports_to: null }],
      messages: [],
    });
    const ok = await canMessageUser({ id: 'u-recruiter', role: 'RECRUITER' }, 'u-my-consultant');
    expect(ok).toBe(true);
  });

  it("denies a recruiter messaging another recruiter's consultant (no relationship)", async () => {
    setupDb({
      recruiters: [
        { id: 'r-mine', user_id: 'u-recruiter', manager_id: null },
        { id: 'r-other', user_id: 'u-other-recruiter', manager_id: null },
      ],
      recruiter_managers: [],
      consultants: [{ recruiter_id: 'r-other', user_id: 'u-stranger-consultant' }],
      users: [{ id: 'u-recruiter', reports_to: null }],
      messages: [],
    });
    const ok = await canMessageUser(
      { id: 'u-recruiter', role: 'RECRUITER' },
      'u-stranger-consultant',
    );
    expect(ok).toBe(false);
  });

  it('refuses messaging oneself regardless of role', async () => {
    const ok = await canMessageUser({ id: 'u-x', role: 'RECRUITER' }, 'u-x');
    expect(ok).toBe(false);
  });
});

describe('canMessageUser — prior-thread legitimacy', () => {
  it('allows a reply when a prior message thread exists, even with no hierarchy link', async () => {
    // A message row between the two parties → the count(head) fast path returns
    // > 0 and short-circuits before the hierarchy lookup runs.
    setupDb({
      messages: [{ id: 'm-1', sender_id: 'u-stranger', recipient_id: 'u-recruiter' }],
    });
    const ok = await canMessageUser({ id: 'u-recruiter', role: 'RECRUITER' }, 'u-stranger');
    expect(ok).toBe(true);
  });
});
