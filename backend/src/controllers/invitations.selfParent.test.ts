/**
 * Regression: a non-admin inviter must be able to assign THEMSELVES as the
 * invitee's parent.
 *
 * resolveAutoParent returns `inviter.id` whenever the inviter's rank qualifies
 * (e.g. RECRUITER inviting a CONSULTANT, or an HR_MANAGER inviting a CONSULTANT/
 * RECRUITER). The frontend then submits parent_user_id = self. The controller's
 * canViewUser gate delegates to canMessageUser, which returns false for self —
 * so without a self carve-out the most common invite flow 403s with
 * "You do not have permission to assign this parent."
 *
 * Asserts: (1) self as parent is accepted WITHOUT calling canViewUser, and
 * (2) a non-self parent the caller can't see still 403s (gate intact).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  parentRow: null as { id: string; role: string; is_active: boolean } | null,
}));

vi.mock('../config/db', () => {
  const b: Record<string, unknown> = {
    select: () => b,
    eq: () => b,
    maybeSingle: () => Promise.resolve({ data: mock.parentRow, error: null }),
  };
  return { db: { from: () => b }, pool: {} };
});
vi.mock('../config/env', () => ({ env: { frontendUrl: 'https://example.test' } }));
vi.mock('../config/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { createInvitationSpy, canViewUserSpy } = vi.hoisted(() => ({
  createInvitationSpy: vi.fn(async (args) => ({ id: 'inv-1', ...args })),
  canViewUserSpy: vi.fn(async () => false), // worst case: caller can't "see" anyone
}));
vi.mock('../services/invitation.service', () => ({
  createInvitation: createInvitationSpy,
  acceptInvitation: vi.fn(),
}));
vi.mock('../services/invitationHierarchy.service', () => ({
  resolveAutoParent: vi.fn(async () => null),
  isAllowedParent: vi.fn(() => true),
  getExpectedParentRoles: vi.fn(() => []),
  getAllValidParentRoles: vi.fn(() => []),
  wireHierarchy: vi.fn(),
}));
vi.mock('../services/permission.service', () => ({ canViewUser: canViewUserSpy }));
vi.mock('../services/groupScope', () => ({ assertCanAssignGroup: vi.fn() }));

import { create } from './invitations.controller';

async function call(user: any, body: any): Promise<{ err: any; body: any }> {
  let payload: any;
  const res: any = {
    status: () => res,
    json: (b: unknown) => {
      payload = b;
    },
  };
  try {
    await (create as any)({ user, body, query: {} }, res, vi.fn());
    return { err: null, body: payload };
  } catch (e) {
    return { err: e, body: payload };
  }
}

const GROUP = '00000000-0000-4000-8000-000000000001';
const REC_ID = '22222222-2222-4222-8222-222222222222';
const RECRUITER = { id: REC_ID, role: 'RECRUITER', group_id: GROUP };

beforeEach(() => {
  createInvitationSpy.mockClear();
  canViewUserSpy.mockClear();
  mock.parentRow = null;
});

describe('invitations.create — self as parent', () => {
  it('RECRUITER inviting a CONSULTANT with parent = self is accepted (canViewUser bypassed)', async () => {
    mock.parentRow = { id: REC_ID, role: 'RECRUITER', is_active: true };
    const { err } = await call(RECRUITER, {
      email: 'c@x.test',
      role: 'CONSULTANT',
      parent_user_id: REC_ID, // self
    });
    expect(err).toBeNull();
    expect(canViewUserSpy).not.toHaveBeenCalled();
    expect(createInvitationSpy).toHaveBeenCalledWith(
      expect.objectContaining({ parentUserId: REC_ID, assignedMode: 'manual' }),
    );
  });

  it('still 403s for a NON-self parent the caller cannot see', async () => {
    mock.parentRow = { id: 'someone-else', role: 'MANAGER', is_active: true };
    const { err } = await call(RECRUITER, {
      email: 'c@x.test',
      role: 'CONSULTANT',
      parent_user_id: '11111111-1111-4111-8111-111111111111', // not self
    });
    expect(err?.status).toBe(403);
    expect(canViewUserSpy).toHaveBeenCalledTimes(1);
    expect(createInvitationSpy).not.toHaveBeenCalled();
  });
});
