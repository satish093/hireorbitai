/**
 * Behavioural regression test for setUserStatus → outstanding password-reset
 * token invalidation.
 *
 * Bug story: a prior session shipped this guard but wrote `consumed_at`
 * instead of the real schema column `used_at` (database/auth-hardening.sql:36).
 * The PostgREST shim returns {error} envelopes, not throws, so the
 * surrounding try/catch never fired. The accompanying static regression
 * test grepped for the buggy literal and went green — a textbook
 * false-green that the A-Z audit caught.
 *
 * This test pins the actual behaviour:
 *  - setUserStatus('inactive') must call .update with `used_at: <iso>`
 *  - filtered by .eq('user_id', target) and .is('used_at', null)
 *  - on a real shim-shaped error envelope, it must log (not throw)
 *  - re-activating (setUserStatus('active')) must NOT touch reset tokens
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  resetUpdates: [] as Array<{
    payload: Record<string, unknown>;
    filters: Record<string, unknown>;
  }>,
  userUpdates: [] as Array<Record<string, unknown>>,
  signOutCalls: [] as Array<{ id: string; scope: string }>,
  // What the user row looks like (so the before-snapshot lookup works).
  beforeUser: { id: 't-1', email: 't@x.test', status: 'active', is_active: true } as Record<
    string,
    unknown
  > | null,
  // Toggle to force the reset-token update path to fail at the shim level
  // (envelope, not throw) — pins that we log instead of swallowing silently.
  resetUpdateError: null as null | { message: string },
}));

vi.mock('../config/db', () => {
  function makeBuilder(table: string) {
    const filters: Record<string, unknown> = {};
    let updatePayload: Record<string, unknown> | null = null;
    const b: Record<string, unknown> = {};
    Object.assign(b, {
      select: () => b,
      eq(col: string, value: unknown) {
        filters[`eq:${col}`] = value;
        return b;
      },
      is(col: string, value: unknown) {
        filters[`is:${col}`] = value;
        return b;
      },
      update(payload: Record<string, unknown>) {
        updatePayload = payload;
        return b;
      },
      maybeSingle: async () => {
        if (table === 'users') return { data: mock.beforeUser, error: null };
        return { data: null, error: null };
      },
      single: async () => {
        if (table === 'users' && updatePayload) {
          mock.userUpdates.push(updatePayload);
          return {
            data: {
              id: mock.beforeUser?.id ?? 't-1',
              email: mock.beforeUser?.email ?? 't@x.test',
              status: updatePayload.status,
              status_reason: updatePayload.status_reason ?? null,
              is_active: updatePayload.is_active,
            },
            error: null,
          };
        }
        return { data: null, error: null };
      },
      then(resolve: (v: unknown) => unknown) {
        // The reset-token .update().eq().is() chain is awaited directly
        // (no .single/.maybeSingle), so it resolves via .then.
        if (table === 'password_reset_tokens' && updatePayload) {
          mock.resetUpdates.push({ payload: updatePayload, filters: { ...filters } });
          return Promise.resolve({
            data: mock.resetUpdateError ? null : [],
            error: mock.resetUpdateError,
          }).then(resolve);
        }
        return Promise.resolve({ data: [], error: null }).then(resolve);
      },
    });
    return b;
  }
  return {
    db: {
      from: (t: string) => makeBuilder(t),
      auth: {
        admin: {
          signOut: async (id: string, scope: string) => {
            mock.signOutCalls.push({ id, scope });
            return { error: null };
          },
        },
      },
    },
    pool: {},
  };
});

vi.mock('../config/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../config/env', () => ({
  env: {
    nodeEnv: 'test',
    jwtSecret: 'test-secret-test-secret-test-secret-1234',
    accessTokenTtlSec: 3600,
    refreshTokenTtlSec: 60 * 60 * 24 * 30,
    bcryptCost: 4,
    passwordResetTokenTtlMin: 30,
    frontendUrl: 'http://localhost:5173',
    appUrl: 'http://localhost:3000',
    brevoApiKey: 'test',
    brevoFromEmail: 'test@x.test',
    brevoFromName: 'Test',
    invitationExpiryHours: 72,
  },
}));
vi.mock('./audit.service', () => ({ audit: vi.fn() }));
vi.mock('./realtime.service', () => ({ publishToUser: vi.fn(async () => undefined) }));
vi.mock('./brevo.service', () => ({
  sendWelcomeWithTempPassword: vi.fn(async () => undefined),
  sendPasswordResetLink: vi.fn(async () => undefined),
  sendPasswordChangedNotice: vi.fn(async () => undefined),
  sendAccountLockedNotice: vi.fn(async () => undefined),
}));

import { setUserStatus } from './auth.service';
import { logger } from '../config/logger';

const ACTOR = { id: 'actor-1', email: 'actor@x.test' };

function fakeReq(): any {
  return { ip: '127.0.0.1', headers: {}, get: () => undefined, log: logger };
}

beforeEach(() => {
  mock.resetUpdates.length = 0;
  mock.userUpdates.length = 0;
  mock.signOutCalls.length = 0;
  mock.resetUpdateError = null;
  mock.beforeUser = { id: 't-1', email: 't@x.test', status: 'active', is_active: true };
  vi.clearAllMocks();
});

describe('setUserStatus — reset-token invalidation behaviour', () => {
  it('on inactive: marks every outstanding token used (used_at set, filtered by user_id + is null)', async () => {
    await setUserStatus({
      targetId: 't-1',
      status: 'inactive',
      reason: 'test',
      actor: ACTOR,
      req: fakeReq(),
    });

    expect(mock.resetUpdates).toHaveLength(1);
    const call = mock.resetUpdates[0]!;

    // The payload sets used_at to an ISO timestamp string — and NOT to
    // consumed_at (the prior buggy literal must never come back).
    expect(call.payload).toHaveProperty('used_at');
    expect(typeof call.payload.used_at).toBe('string');
    expect(call.payload).not.toHaveProperty('consumed_at');
    expect(() => new Date(call.payload.used_at as string).toISOString()).not.toThrow();

    // Filters: scoped to this user, only touching un-consumed tokens.
    expect(call.filters['eq:user_id']).toBe('t-1');
    expect(call.filters['is:used_at']).toBeNull();
    expect(call.filters['is:consumed_at']).toBeUndefined();
  });

  it('on inactive: refresh tokens are revoked via signOut("global")', async () => {
    await setUserStatus({
      targetId: 't-1',
      status: 'inactive',
      actor: ACTOR,
      req: fakeReq(),
    });
    expect(mock.signOutCalls).toEqual([{ id: 't-1', scope: 'global' }]);
  });

  it('on suspended/banned/pending_verification: same invalidation fires (any non-active state)', async () => {
    for (const status of ['suspended', 'banned', 'pending_verification'] as const) {
      mock.resetUpdates.length = 0;
      await setUserStatus({ targetId: 't-1', status, actor: ACTOR, req: fakeReq() });
      expect(mock.resetUpdates, `expected reset invalidation for status=${status}`).toHaveLength(1);
      expect(mock.resetUpdates[0]!.payload.used_at).toBeDefined();
    }
  });

  it('on REACTIVATE (active): does NOT touch password_reset_tokens', async () => {
    // Start from a deactivated row so the transition is back-to-active.
    mock.beforeUser = { id: 't-1', email: 't@x.test', status: 'inactive', is_active: false };
    await setUserStatus({
      targetId: 't-1',
      status: 'active',
      actor: ACTOR,
      req: fakeReq(),
    });
    expect(mock.resetUpdates).toHaveLength(0);
    expect(mock.signOutCalls).toHaveLength(0);
  });

  it('on shim {error} envelope: logs (does not throw) — silent-failure regression guard', async () => {
    // This is the case that the prior consumed_at typo would have hit in
    // production every single time: the shim returns an error envelope, the
    // try/catch never fires (no throw), and the failure is invisible. The
    // current code destructures and logger.warn's; assert that.
    mock.resetUpdateError = { message: 'column "used_at" does not exist' };
    await expect(
      setUserStatus({
        targetId: 't-1',
        status: 'inactive',
        actor: ACTOR,
        req: fakeReq(),
      }),
    ).resolves.toBeDefined();
    expect((logger.warn as any).mock.calls.length).toBeGreaterThanOrEqual(1);
    const warned = (logger.warn as any).mock.calls.some(
      (args: unknown[]) =>
        typeof args[1] === 'string' &&
        (args[1] as string).includes('failed to invalidate outstanding password reset tokens'),
    );
    expect(warned).toBe(true);
  });
});
