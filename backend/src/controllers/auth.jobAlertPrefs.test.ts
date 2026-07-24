/**
 * Guards for the criteria-based job-alert prefs endpoints
 * (auth.getJobAlertPrefs / auth.setJobAlertPrefs).
 *
 * Locks in:
 *   - the write schema is `.strict()` → unknown body fields are rejected (no
 *     mass-assignment; a forged `user_id` in the body never reaches the DB),
 *   - user_id on the upsert row is the SESSION id, server-set,
 *   - min_match is range-checked,
 *   - reads/writes are fail-open when the table isn't migrated yet,
 *   - GET returns sensible defaults when no row exists.
 *
 * DB + service deps are mocked so the controller imports without env.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const dbState = vi.hoisted(() => ({
  lastUpsert: null as Record<string, unknown> | null,
  upsertError: null as { message: string } | null,
  selectData: null as unknown,
  selectError: null as { message: string } | null,
}));

vi.mock('../config/db', () => ({
  db: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: dbState.selectData, error: dbState.selectError }),
        }),
      }),
      upsert: async (row: Record<string, unknown>) => {
        dbState.lastUpsert = row;
        return { data: null, error: dbState.upsertError };
      },
    }),
  },
  pool: {},
}));
vi.mock('../config/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../services/audit.service', () => ({ audit: vi.fn() }));
vi.mock('../services/auth.service', () => ({}));

import { getJobAlertPrefs, setJobAlertPrefs } from './auth.controller';

const USER = { id: 'user-self', role: 'CONSULTANT' };

function mkRes() {
  const r: any = {
    statusCode: 200,
    body: undefined as unknown,
    status(c: number) {
      this.statusCode = c;
      return this;
    },
    json(b: unknown) {
      this.body = b;
      return this;
    },
  };
  return r;
}

async function call(handler: any, body: unknown, user: unknown = USER) {
  const res = mkRes();
  try {
    await handler({ body, params: {}, query: {}, user } as any, res, vi.fn());
    return { res, err: null as { status?: number } | null };
  } catch (e) {
    return { res, err: e as { status?: number } };
  }
}

beforeEach(() => {
  dbState.lastUpsert = null;
  dbState.upsertError = null;
  dbState.selectData = null;
  dbState.selectError = null;
});

describe('setJobAlertPrefs — strict schema + server-set user_id', () => {
  it('rejects unknown body fields (forged user_id never reaches the DB)', async () => {
    const { err } = await call(setJobAlertPrefs, { user_id: 'victim', min_match: 70 });
    expect(err?.status).toBe(400);
    expect(dbState.lastUpsert).toBeNull();
  });

  it('range-checks min_match', async () => {
    const { err } = await call(setJobAlertPrefs, { min_match: 150 });
    expect(err?.status).toBe(400);
  });

  it('upserts with the session user_id, not anything client-supplied', async () => {
    const { err } = await call(setJobAlertPrefs, {
      keywords: ['React'],
      locations: ['Austin'],
      remote_only: true,
      min_match: 80,
    });
    expect(err).toBeNull();
    expect(dbState.lastUpsert?.user_id).toBe('user-self');
    expect(dbState.lastUpsert?.keywords).toEqual(['React']);
    expect(dbState.lastUpsert?.remote_only).toBe(true);
  });

  it('is fail-open when the table is not migrated yet', async () => {
    dbState.upsertError = { message: 'relation "user_job_alert_prefs" does not exist' };
    const { err, res } = await call(setJobAlertPrefs, { min_match: 60 });
    expect(err).toBeNull();
    expect(res.body).toMatchObject({ ok: true, persisted: false });
  });
});

describe('getJobAlertPrefs — defaults + fail-open', () => {
  it('returns defaults when the user has no prefs row', async () => {
    const { err, res } = await call(getJobAlertPrefs, {});
    expect(err).toBeNull();
    expect(res.body).toMatchObject({
      keywords: [],
      locations: [],
      remote_only: false,
      min_match: 60,
    });
  });

  it('returns defaults (not 500) when the table is missing', async () => {
    dbState.selectError = { message: 'schema cache reload required: does not exist' };
    const { err, res } = await call(getJobAlertPrefs, {});
    expect(err).toBeNull();
    expect(res.body).toMatchObject({ min_match: 60 });
  });

  it('returns the stored row when present', async () => {
    dbState.selectData = {
      keywords: ['Go'],
      locations: [],
      remote_only: true,
      min_match: 90,
      job_function: null,
    };
    const { res } = await call(getJobAlertPrefs, {});
    expect(res.body).toMatchObject({ keywords: ['Go'], remote_only: true, min_match: 90 });
  });
});
