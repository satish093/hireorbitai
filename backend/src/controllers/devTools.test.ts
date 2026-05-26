/**
 * Super-Admin DEV test panel handlers. The route triple-gate (requireDevTools +
 * requireAuth + requireRole SUPER_ADMIN) is wired in devTools.routes; here we
 * cover the handler behaviour: getIntegrations returns all known namespaces,
 * and putIntegration validates the namespace + body via the strict schema.
 */

import { describe, it, expect, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  rows: [{ key: 'ai_keys', value: { anthropic: 'sk-test' }, updated_at: 't' }] as any[],
  upsertError: null as { message: string } | null,
}));

vi.mock('../config/db', () => {
  function builder() {
    const b: any = {};
    Object.assign(b, {
      select: () => b,
      eq: () => b,
      maybeSingle: () => Promise.resolve({ data: mock.rows[0] ?? null, error: null }),
      upsert: () => Promise.resolve({ error: mock.upsertError }),
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: mock.rows, error: null }).then(resolve),
    });
    return b;
  }
  return { db: { from: () => builder() }, pool: {} };
});

import { getIntegrations, putIntegration } from './devTools.controller';

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

async function call(handler: any, req: any) {
  const res = mkRes();
  try {
    await handler({ body: {}, params: {}, user: { id: 'u-1' }, ...req }, res, vi.fn());
    return { res, err: null as { status?: number } | null };
  } catch (e) {
    return { res, err: e as { status?: number } };
  }
}

describe('devTools.getIntegrations', () => {
  it('returns every known namespace (filling missing ones with {})', async () => {
    const { err, res } = await call(getIntegrations, {});
    expect(err).toBeNull();
    expect(res.body).toHaveProperty('ai_keys');
    expect(res.body).toHaveProperty('smtp');
    expect(res.body).toHaveProperty('experimental');
    expect(res.body.ai_keys).toEqual({ anthropic: 'sk-test' });
  });
});

describe('devTools.putIntegration', () => {
  it('upserts a valid known namespace', async () => {
    const { err, res } = await call(putIntegration, {
      body: { key: 'smtp', value: { host: 'mail.local', port: 587 } },
    });
    expect(err).toBeNull();
    expect(res.body).toEqual({ ok: true });
  });

  it('400s on an unknown namespace key', async () => {
    const { err } = await call(putIntegration, {
      body: { key: 'not_a_namespace', value: {} },
    });
    expect(err?.status).toBe(400);
  });

  it('400s when value is missing', async () => {
    const { err } = await call(putIntegration, { body: { key: 'smtp' } });
    expect(err?.status).toBe(400);
  });
});
