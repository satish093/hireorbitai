/**
 * Guards on createInvitation for duplicate invites:
 *   1. an email that already has an account is rejected with 409 up front
 *      (instead of a dead-end link that only fails at the password step), and
 *   2. re-inviting an email with a still-PENDING invite SUPERSEDES the old one
 *      (revokes prior pending rows for that email) so only the newest link is
 *      valid — "resend with a fresh link".
 *
 * DB + Brevo are mocked so the test runs without Postgres / env.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  existingUser: null as { id: string } | null,
  insertedRow: { id: 'inv-new', status: 'PENDING' } as Record<string, unknown>,
  revoke: null as null | { status?: unknown; eqs: Array<[string, unknown]>; neqId?: unknown },
}));

vi.mock('../config/db', () => {
  function makeBuilder(table: string) {
    const state: {
      table: string;
      op: 'insert' | 'update' | null;
      updatePayload: Record<string, unknown> | null;
      eqs: Array<[string, unknown]>;
      neqId?: unknown;
    } = { table, op: null, updatePayload: null, eqs: [] };
    const b: Record<string, unknown> = {
      select: () => b,
      insert: () => {
        state.op = 'insert';
        return b;
      },
      update: (payload: Record<string, unknown>) => {
        state.op = 'update';
        state.updatePayload = payload;
        return b;
      },
      eq: (col: string, val: unknown) => {
        state.eqs.push([col, val]);
        return b;
      },
      neq: (_col: string, val: unknown) => {
        state.neqId = val;
        return b;
      },
      maybeSingle: () =>
        Promise.resolve({
          data: state.table === 'users' ? mock.existingUser : null,
          error: null,
        }),
      single: () => Promise.resolve({ data: mock.insertedRow, error: null }),
      // the supersede chain ends in `.then(...)` (no maybeSingle/single)
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
        if (state.op === 'update') {
          mock.revoke = { status: state.updatePayload?.status, eqs: state.eqs, neqId: state.neqId };
        }
        return Promise.resolve({ data: null, error: null }).then(resolve, reject);
      },
    };
    return b;
  }
  return { db: { from: (t: string) => makeBuilder(t) }, pool: {} };
});

vi.mock('../config/env', () => ({
  env: { invitationExpiryHours: 72, frontendUrl: 'https://app.test' },
}));
vi.mock('../config/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../services/invitationHierarchy.service', () => ({ wireHierarchy: vi.fn() }));

const sendInvitationLink = vi.fn().mockResolvedValue(undefined);
vi.mock('../services/brevo.service', () => ({
  sendInvitationLink: (...a: unknown[]) => sendInvitationLink(...a),
}));

import { createInvitation } from './invitation.service';

beforeEach(() => {
  mock.existingUser = null;
  mock.insertedRow = { id: 'inv-new', status: 'PENDING' };
  mock.revoke = null;
  sendInvitationLink.mockClear();
});

describe('createInvitation — duplicate-invite guards', () => {
  it('rejects with 409 when the email already has an account (no insert, no email)', async () => {
    mock.existingUser = { id: 'u-existing' };
    await expect(
      createInvitation({ email: 'Taken@X.test', role: 'CONSULTANT', invitedBy: 'u-admin' }),
    ).rejects.toMatchObject({ status: 409 });
    expect(sendInvitationLink).not.toHaveBeenCalled();
    expect(mock.revoke).toBeNull();
  });

  it('supersedes prior PENDING invites for the same email and sends the fresh link', async () => {
    mock.existingUser = null;
    const out = await createInvitation({
      email: 'New@X.test',
      role: 'CONSULTANT',
      invitedBy: 'u-admin',
    });

    expect(out).toMatchObject({ email_sent: true });
    expect(sendInvitationLink).toHaveBeenCalledTimes(1);
    // older pending invites for THIS email (lowercased), excluding the new row, are revoked
    expect(mock.revoke).not.toBeNull();
    expect(mock.revoke?.status).toBe('REVOKED');
    expect(mock.revoke?.eqs).toContainEqual(['email', 'new@x.test']);
    expect(mock.revoke?.eqs).toContainEqual(['status', 'PENDING']);
    expect(mock.revoke?.neqId).toBe('inv-new');
  });
});
