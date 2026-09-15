/**
 * HACP inbound sync webhook (Oracle "Hermes" box -> jobs table).
 *
 * Locks in:
 *   - 503 when HACP_SYNC_SECRET isn't configured (endpoint stays dark until
 *     both sides are provisioned),
 *   - 400 on missing signature/body, 403 on a signature that doesn't match
 *     (constant-time compare, not ==),
 *   - the write schema is `.strict()` — an unexpected field (e.g. a forged
 *     `created_by`) is rejected before it ever reaches the upsert row,
 *   - the upserted row shape: source='linkedin_hacp', external_id=fingerprint,
 *     JSON-string skills fields parsed defensively, remote inferred from
 *     work_model/location, extra fields folded into `requirements`,
 *   - retry-and-strip on a schema-cache error (database.md convention),
 *   - empty `jobs: []` short-circuits without touching the DB.
 *
 * DB + env + audit are mocked so the controller imports without Postgres.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';

const dbState = vi.hoisted(() => ({
  lastUpsert: null as Record<string, unknown>[] | null,
  upsertError: null as { message: string } | null,
  upsertCount: 1,
  upsertCalls: 0,
}));

const envState = vi.hoisted(() => ({
  syncSecret: 'test-hacp-secret' as string | undefined,
}));

const auditState = vi.hoisted(() => ({
  calls: [] as Array<{ action: string; metadata?: Record<string, unknown> }>,
}));

vi.mock('../config/db', () => ({
  db: {
    from: () => ({
      upsert: async (rows: Record<string, unknown>[]) => {
        dbState.upsertCalls += 1;
        dbState.lastUpsert = rows;
        if (dbState.upsertError) {
          const err = dbState.upsertError;
          dbState.upsertError = null; // only fail the first attempt, like a real retry
          return { data: null, error: err };
        }
        return { data: null, error: null, count: dbState.upsertCount };
      },
    }),
  },
  pool: {},
}));

vi.mock('../config/env', () => ({
  env: {
    hacp: {
      get syncSecret() {
        return envState.syncSecret;
      },
    },
  },
}));

vi.mock('../config/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../services/audit.service', () => ({
  audit: (input: { action: string; metadata?: Record<string, unknown> }) => {
    auditState.calls.push(input);
  },
}));

import { receiveSync } from './hacpWebhook.controller';

const SECRET = 'test-hacp-secret';

function sign(secret: string, raw: Buffer): string {
  return createHmac('sha256', secret).update(raw).digest('hex');
}

function mkReq(
  payload: unknown,
  opts: { secret?: string; noRawBody?: boolean; noSig?: boolean } = {},
) {
  const raw = Buffer.from(JSON.stringify(payload));
  const sig = opts.noSig ? undefined : sign(opts.secret ?? SECRET, raw);
  return {
    body: payload,
    rawBody: opts.noRawBody ? undefined : raw,
    headers: sig ? { 'x-hacp-signature': sig } : {},
  } as any;
}

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

async function call(payload: unknown, opts: Parameters<typeof mkReq>[1] = {}) {
  const req = mkReq(payload, opts);
  const res = mkRes();
  try {
    await receiveSync(req, res, vi.fn());
    return { res, err: null as { status?: number; message?: string } | null };
  } catch (e) {
    return { res, err: e as { status?: number; message?: string } };
  }
}

const VALID_JOB = {
  fingerprint: 'fp-abc123',
  title: 'Senior DevOps Engineer',
  company: 'Acme Corp',
  location: 'Remote - US',
  work_model: 'Remote',
  seniority_level: 'Senior',
  experience_years_str: '5+ yrs',
  min_experience_years: 5,
  h1b_sponsorship: false,
  posted_date: '2026-09-14',
  skills_required: JSON.stringify(['AWS', 'Docker', 'Kubernetes']),
  skills_tags: JSON.stringify(['AWS', 'Docker']),
  salary_min: 140000,
  salary_max: 180000,
  salary_currency: 'USD',
  ats_provider: 'greenhouse',
  apply_url: 'https://acme.example.com/careers/123',
  full_description: 'Own our cloud infrastructure...',
};

beforeEach(() => {
  dbState.lastUpsert = null;
  dbState.upsertError = null;
  dbState.upsertCount = 1;
  dbState.upsertCalls = 0;
  envState.syncSecret = SECRET;
  auditState.calls = [];
});

describe('receiveSync — gating', () => {
  it('503s when HACP_SYNC_SECRET is not configured', async () => {
    envState.syncSecret = undefined;
    const { err } = await call({ jobs: [VALID_JOB] });
    expect(err?.status).toBe(503);
    expect(dbState.upsertCalls).toBe(0);
  });

  it('400s when the signature header is missing', async () => {
    const { err } = await call({ jobs: [VALID_JOB] }, { noSig: true });
    expect(err?.status).toBe(400);
  });

  it('400s when rawBody was never captured', async () => {
    const { err } = await call({ jobs: [VALID_JOB] }, { noRawBody: true });
    expect(err?.status).toBe(400);
  });

  it('403s on a signature computed with the wrong secret', async () => {
    const { err } = await call({ jobs: [VALID_JOB] }, { secret: 'wrong-secret' });
    expect(err?.status).toBe(403);
    expect(dbState.upsertCalls).toBe(0);
    expect(auditState.calls.map((c) => c.action)).toContain('hacp_sync_rejected');
  });
});

describe('receiveSync — payload validation (.strict())', () => {
  it('400s on an unrecognized field (mass-assignment guard)', async () => {
    const { err } = await call({
      jobs: [{ ...VALID_JOB, created_by: 'attacker-controlled' }],
    });
    expect(err?.status).toBe(400);
    expect(dbState.upsertCalls).toBe(0);
  });

  it('400s when a required field is missing', async () => {
    const bad = { ...VALID_JOB } as any;
    delete bad.title;
    const { err } = await call({ jobs: [bad] });
    expect(err?.status).toBe(400);
  });

  it('200s with ingested: 0 and never touches the DB for an empty jobs array', async () => {
    const { err, res } = await call({ jobs: [] });
    expect(err).toBeNull();
    expect(res.body).toEqual({ ingested: 0 });
    expect(dbState.upsertCalls).toBe(0);
  });
});

describe('receiveSync — happy path row shape', () => {
  it('maps the Oracle payload to the jobs table shape correctly', async () => {
    const { err, res } = await call({ jobs: [VALID_JOB] });
    expect(err).toBeNull();
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ingested: 1 });

    const row = dbState.lastUpsert?.[0];
    expect(row).toMatchObject({
      source: 'linkedin_hacp',
      external_id: 'fp-abc123',
      title: 'Senior DevOps Engineer',
      company_name: 'Acme Corp',
      remote: true,
      level: 'Senior',
      required_skills: ['AWS', 'Docker', 'Kubernetes'],
      rate_min: 140000,
      rate_max: 180000,
      apply_url: 'https://acme.example.com/careers/123',
      publisher: 'LinkedIn',
      is_active: true,
    });
    expect(row?.requirements).toMatchObject({
      ats_provider: 'greenhouse',
      salary_currency: 'USD',
      h1b_sponsorship: false,
      skills_tags: ['AWS', 'Docker'],
    });
    expect(auditState.calls.map((c) => c.action)).toContain('hacp_sync_received');
  });

  it('falls back to a search URL when apply_url is missing/unsafe', async () => {
    const { err } = await call({ jobs: [{ ...VALID_JOB, apply_url: 'javascript:alert(1)' }] });
    expect(err).toBeNull();
    const row = dbState.lastUpsert?.[0];
    expect(row?.apply_url).toMatch(/^https:\/\/www\.google\.com\/search/);
  });

  it('tolerates unparseable skills JSON without failing the whole job', async () => {
    const { err } = await call({ jobs: [{ ...VALID_JOB, skills_required: 'not json' }] });
    expect(err).toBeNull();
    const row = dbState.lastUpsert?.[0];
    expect(row?.required_skills).toEqual([]);
  });

  it('retries with publisher/requirements stripped on a schema-cache error', async () => {
    dbState.upsertError = {
      message: 'column "requirements" of relation "jobs" in the schema cache',
    };
    const { err, res } = await call({ jobs: [VALID_JOB] });
    expect(err).toBeNull();
    expect(res.body).toEqual({ ingested: 1 });
    expect(dbState.upsertCalls).toBe(2);
    expect(dbState.lastUpsert?.[0]).not.toHaveProperty('requirements');
    expect(dbState.lastUpsert?.[0]).not.toHaveProperty('publisher');
  });

  it('500s when the upsert fails for a non-schema-cache reason', async () => {
    dbState.upsertError = { message: 'connection refused' };
    const { err } = await call({ jobs: [VALID_JOB] });
    expect(err?.status).toBe(500);
  });
});
