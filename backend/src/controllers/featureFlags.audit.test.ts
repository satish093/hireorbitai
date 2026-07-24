/**
 * Regression test for feature-flag audit emission.
 *
 * Bug: setFlag and setGroupOverride mutated the DB without writing an
 * auth_audit_logs row. Feature flags gate /tasks /training /messages /calls
 * /interviews /reminders /reports /ai /jobs /applications, so a privileged
 * caller could silently flip → exfil → flip back with zero trail.
 *
 * Fix: both setters now emit a `feature_flag_changed` (or
 * `feature_flag_group_override_changed`) audit entry with from→to metadata.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  flagRow: { enabled: false } as { enabled?: boolean } | null,
  overrideRow: null as { enabled?: boolean } | null,
  auditCalls: [] as Array<{
    action: string;
    user_id?: string | null;
    metadata?: Record<string, unknown>;
  }>,
}));

vi.mock('../config/db', () => {
  function makeBuilder(table: string) {
    const b: Record<string, unknown> = {};
    Object.assign(b, {
      select: () => b,
      eq: () => b,
      delete: () => b,
      update: () => b,
      upsert: () => b,
      maybeSingle: async () => {
        if (table === 'feature_flags') return { data: mock.flagRow, error: null };
        if (table === 'group_feature_flags') return { data: mock.overrideRow, error: null };
        return { data: null, error: null };
      },
      single: async () => ({
        data:
          table === 'feature_flags'
            ? { key: 'training', enabled: true, updated_at: '2026-05-29T00:00:00.000Z' }
            : null,
        error: null,
      }),
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: [], error: null }).then(resolve),
    });
    return b;
  }
  return { db: { from: (t: string) => makeBuilder(t) }, pool: {} };
});

vi.mock('../services/audit.service', () => ({
  audit: (entry: {
    action: string;
    user_id?: string | null;
    metadata?: Record<string, unknown>;
  }) => {
    mock.auditCalls.push(entry);
  },
}));

import { setFlag, setGroupOverride } from './featureFlags.controller';

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

const ACTOR = {
  id: 'u-admin',
  role: 'SUPER_ADMIN',
  email: 'admin@x.test',
  group_id: null,
};

async function callSetFlag(
  key: string,
  body: unknown,
): Promise<{ err: { status?: number } | null; res: ReturnType<typeof mkRes> }> {
  const res = mkRes();
  try {
    await (setFlag as any)(
      { user: ACTOR, body, params: { key }, ip: '127.0.0.1', headers: {} },
      res,
      vi.fn(),
    );
    return { err: null, res };
  } catch (e) {
    return { err: e as { status?: number }, res };
  }
}

async function callSetOverride(
  groupId: string,
  key: string,
  body: unknown,
): Promise<{ err: { status?: number } | null; res: ReturnType<typeof mkRes> }> {
  const res = mkRes();
  try {
    await (setGroupOverride as any)(
      { user: ACTOR, body, params: { groupId, key }, ip: '127.0.0.1', headers: {} },
      res,
      vi.fn(),
    );
    return { err: null, res };
  } catch (e) {
    return { err: e as { status?: number }, res };
  }
}

beforeEach(() => {
  mock.auditCalls.length = 0;
  mock.flagRow = { enabled: false };
  mock.overrideRow = null;
});

describe('featureFlags.setFlag — audit emission', () => {
  it('emits feature_flag_changed with from→to and the actor', async () => {
    mock.flagRow = { enabled: false };
    const { err } = await callSetFlag('training', { enabled: true });
    expect(err).toBeNull();
    const a = mock.auditCalls.find((a) => a.action === 'feature_flag_changed');
    expect(a).toBeDefined();
    expect(a?.user_id).toBe(ACTOR.id);
    expect(a?.metadata).toMatchObject({ key: 'training', from: false, to: true });
  });

  it('rejects unknown body keys (strict schema — defense vs payload bloat)', async () => {
    const { err } = await callSetFlag('training', { enabled: true, force: true });
    expect(err?.status).toBe(400);
    expect(mock.auditCalls).toHaveLength(0);
  });
});

describe('featureFlags.setGroupOverride — audit emission', () => {
  it('emits feature_flag_group_override_changed for the upsert (set) branch', async () => {
    mock.overrideRow = null; // no prior override
    const { err } = await callSetOverride('g-1', 'training', { enabled: true });
    expect(err).toBeNull();
    const a = mock.auditCalls.find((a) => a.action === 'feature_flag_group_override_changed');
    expect(a).toBeDefined();
    expect(a?.metadata).toMatchObject({ key: 'training', group_id: 'g-1', from: null, to: true });
  });

  it('emits feature_flag_group_override_changed for the delete (clear) branch with to=null', async () => {
    mock.overrideRow = { enabled: true };
    const { err } = await callSetOverride('g-2', 'training', { enabled: null });
    expect(err).toBeNull();
    const a = mock.auditCalls.find((a) => a.action === 'feature_flag_group_override_changed');
    expect(a).toBeDefined();
    expect(a?.metadata).toMatchObject({ key: 'training', group_id: 'g-2', from: true, to: null });
  });
});
