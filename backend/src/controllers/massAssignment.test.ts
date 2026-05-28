/**
 * Mass-assignment regression tests for the org-entity controllers
 * (clients / vendors / jobs). These prove that the `.strict()` Zod allowlists
 * added to create/update reject server-controlled and unknown fields, and that
 * `created_by` is always set server-side from req.user — never from the body.
 *
 * See .claude/rules/security.md "Never db.update(req.body)". The DB shim is
 * mocked so we can capture exactly what payload would have hit the table.
 *
 * jobs.controller pulls a heavy import tree (ai/jobParser/resumes/applications)
 * at module load; each is stubbed so importing the controller never reaches
 * config/env. config/db is stubbed to record insert/update payloads.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mock = vi.hoisted(() => {
  const calls: { op: 'insert' | 'update'; table: string; payload: Record<string, unknown> }[] = [];
  return { calls };
});

vi.mock('../config/db', () => {
  function makeBuilder(table: string) {
    const b: Record<string, unknown> = {};
    Object.assign(b, {
      insert(payload: Record<string, unknown>) {
        mock.calls.push({ op: 'insert', table, payload });
        return b;
      },
      update(payload: Record<string, unknown>) {
        mock.calls.push({ op: 'update', table, payload });
        return b;
      },
      eq: () => b,
      select: () => b,
      single: () => Promise.resolve({ data: { id: 'new-id' }, error: null }),
      // Controllers' update() now loads the existing row via .maybeSingle()
      // for the "owner OR manager" check before mutating. Return a stub
      // row whose created_by matches ACTOR so non-manager updates pass
      // the ownership branch and we still reach the payload-capture path.
      maybeSingle: () =>
        Promise.resolve({ data: { id: 'new-id', created_by: 'u-actor' }, error: null }),
    });
    return b;
  }
  return { db: { from: (t: string) => makeBuilder(t) }, pool: {} };
});

// Stub the heavy modules jobs.controller imports at load time.
vi.mock('../config/anthropic', () => ({ ANTHROPIC_ENABLED: false, AI_AVAILABLE: false }));
vi.mock('../services/ai.service', () => ({
  matchJobsForConsultant: vi.fn(),
  atsScore: vi.fn(),
  scoreResumeAgainstJob: vi.fn(),
  jobCopilot: vi.fn(),
}));
vi.mock('../services/jobParser.service', () => ({ parseJobRequirements: vi.fn() }));
vi.mock('./resumes.controller', () => ({ tailorForJob: vi.fn() }));
vi.mock('./applications.controller', () => ({ fromJob: vi.fn() }));
vi.mock('../config/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import * as clients from './clients.controller';
import * as vendors from './vendors.controller';
import * as jobs from './jobs.controller';

type Handler = (req: any, res: any, next: any) => unknown | Promise<unknown>;

const ACTOR = { id: 'u-actor', role: 'MANAGER' };

function mkRes() {
  const res: any = {
    statusCode: 200,
    body: undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(b: unknown) {
      this.body = b;
      return this;
    },
  };
  return res;
}

/** Invoke a handler; return the thrown httpError (or null if it resolved). */
async function callExpectingError(
  handler: Handler,
  body: unknown,
  params: Record<string, string> = {},
): Promise<{ status?: number } | null> {
  try {
    await handler({ body, params, user: ACTOR }, mkRes(), vi.fn());
    return null;
  } catch (e) {
    return e as { status?: number };
  }
}

/** Invoke a handler that should succeed; return the captured DB payload. */
async function callCapturingPayload(
  handler: Handler,
  body: unknown,
  params: Record<string, string> = {},
): Promise<Record<string, unknown>> {
  await handler({ body, params, user: ACTOR }, mkRes(), vi.fn());
  const last = mock.calls.at(-1);
  if (!last) throw new Error('no DB call was recorded');
  return last.payload;
}

beforeEach(() => {
  mock.calls.length = 0;
});

// Each entry: a label, its create/update handlers, a minimal valid body, and a
// field that legitimately belongs to the table (to confirm it survives).
const SUITES = [
  {
    name: 'clients',
    create: clients.create as Handler,
    update: clients.update as Handler,
    valid: { company_name: 'Acme Corp', contact_email: 'hi@acme.test' },
    keptField: 'contact_email',
  },
  {
    name: 'vendors',
    create: vendors.create as Handler,
    update: vendors.update as Handler,
    valid: { company_name: 'Acme Staffing', tier: 'T1' },
    keptField: 'tier',
  },
  {
    name: 'jobs',
    create: jobs.create as Handler,
    update: jobs.update as Handler,
    valid: { title: 'Senior Engineer', remote: true },
    keptField: 'remote',
  },
];

for (const s of SUITES) {
  describe(`${s.name} controller — mass-assignment guard`, () => {
    it('create sets created_by server-side and keeps only whitelisted fields', async () => {
      const payload = await callCapturingPayload(s.create, s.valid);
      expect(payload.created_by).toBe(ACTOR.id);
      expect(payload[s.keptField]).toBe((s.valid as Record<string, unknown>)[s.keptField]);
      // No server-owned column leaked in from anywhere.
      expect(payload).not.toHaveProperty('id');
      expect(payload).not.toHaveProperty('created_at');
      expect(payload).not.toHaveProperty('updated_at');
    });

    it('create rejects an attacker-supplied created_by', async () => {
      const err = await callExpectingError(s.create, { ...s.valid, created_by: 'u-attacker' });
      expect(err?.status).toBe(400);
    });

    it('create rejects unknown / privileged fields (strict schema)', async () => {
      const err = await callExpectingError(s.create, { ...s.valid, is_admin: true, role: 'CEO' });
      expect(err?.status).toBe(400);
    });

    it('update rejects created_by / id overwrite', async () => {
      const errCreatedBy = await callExpectingError(
        s.update,
        { created_by: 'u-attacker' },
        { id: 'row-1' },
      );
      expect(errCreatedBy?.status).toBe(400);
      const errId = await callExpectingError(s.update, { id: 'spoofed' }, { id: 'row-1' });
      expect(errId?.status).toBe(400);
    });

    it('update passes through only whitelisted fields (no created_by injected)', async () => {
      const payload = await callCapturingPayload(s.update, s.valid, { id: 'row-1' });
      expect(payload).not.toHaveProperty('created_by');
      expect(payload).not.toHaveProperty('id');
      expect(payload[s.keptField]).toBe((s.valid as Record<string, unknown>)[s.keptField]);
    });
  });
}
