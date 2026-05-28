/**
 * Group-default behavior on invitations.create.
 *
 * Phase 14 invariant: a recruiter or group lead invitation always lands the
 * invitee in the CALLER's own group. The handler defaults a missing group_id
 * to req.user.group_id for non-admins, then funnels through assertCanAssignGroup
 * which still rejects any other group_id. Admin-tier still controls group freely
 * (including "no group" via null).
 *
 * DB / heavy services are mocked so the test runs without Postgres / env.
 * assertCanAssignGroup is REAL — we're verifying its interaction with the new
 * defaulting logic.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────────
vi.mock('../config/db', () => ({ db: {}, pool: {} }));
vi.mock('../config/env', () => ({ env: { frontendUrl: 'https://example.test' } }));
vi.mock('../config/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { createInvitationSpy, resolveAutoParentSpy } = vi.hoisted(() => ({
  createInvitationSpy: vi.fn(async (args) => ({ id: 'inv-1', ...args })),
  resolveAutoParentSpy: vi.fn(async () => null),
}));
vi.mock('../services/invitation.service', () => ({
  createInvitation: createInvitationSpy,
  acceptInvitation: vi.fn(),
}));
vi.mock('../services/invitationHierarchy.service', () => ({
  resolveAutoParent: resolveAutoParentSpy,
  isAllowedParent: vi.fn(() => true),
  getExpectedParentRoles: vi.fn(() => []),
  getAllValidParentRoles: vi.fn(() => []),
  wireHierarchy: vi.fn(),
}));
vi.mock('../services/permission.service', () => ({ canViewUser: vi.fn() }));
vi.mock('../utils/password', () => ({ validatePasswordStrength: vi.fn() }));

import { create } from './invitations.controller';

// ── Helpers ──────────────────────────────────────────────────────────────────
async function call(user: any, body: any): Promise<{ err: any; body: any }> {
  let payload: any;
  const res: any = {
    status: (_c: number) => res,
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

// req.user.group_id is never user-supplied input, so it isn't UUID-validated
// by Zod — but explicit body.group_id IS, so the test fixtures below use real
// UUIDs for the body values.
const G_REC = '00000000-0000-4000-8000-000000000001';
const G_HR = '00000000-0000-4000-8000-000000000002';
const G_ANY = '00000000-0000-4000-8000-000000000003';
const G_ATTACKER = '00000000-0000-4000-8000-000000000004';

const RECRUITER = { id: 'u-rec', role: 'RECRUITER', group_id: G_REC };
const HR_LEAD = { id: 'u-hr', role: 'HR_MANAGER', group_id: G_HR };
const DIRECTOR = { id: 'u-dir', role: 'DIRECTOR', group_id: null };

beforeEach(() => {
  createInvitationSpy.mockClear();
  resolveAutoParentSpy.mockClear();
});

describe('invitations.create — non-admin defaults group_id to caller.group_id', () => {
  it("RECRUITER inviting CONSULTANT with no group_id ⇒ lands in recruiter's group", async () => {
    const { err } = await call(RECRUITER, { email: 'c@x.test', role: 'CONSULTANT' });
    expect(err).toBeNull();
    expect(createInvitationSpy).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'CONSULTANT', groupId: G_REC }),
    );
  });

  it("HR_MANAGER inviting MANAGER with no group_id ⇒ lands in lead's group", async () => {
    const { err } = await call(HR_LEAD, { email: 'm@x.test', role: 'MANAGER' });
    expect(err).toBeNull();
    expect(createInvitationSpy).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'MANAGER', groupId: G_HR }),
    );
  });

  it('RECRUITER passing their OWN group_id explicitly is allowed', async () => {
    const { err } = await call(RECRUITER, {
      email: 'c@x.test',
      role: 'CONSULTANT',
      group_id: G_REC,
    });
    expect(err).toBeNull();
    expect(createInvitationSpy).toHaveBeenCalledWith(expect.objectContaining({ groupId: G_REC }));
  });

  it('RECRUITER passing a DIFFERENT group_id is silently forced back to their own group', async () => {
    // The controller now FORCES the invitee into the caller's group rather
    // than just defaulting it. An explicit body.group_id from a non-admin
    // caller is ignored — the only way to land in a different group is to
    // be admin-tier. This is the belt-and-braces fix for the recruiter
    // invite edge case in docs/rbac-overview.html.
    const { err } = await call(RECRUITER, {
      email: 'c@x.test',
      role: 'CONSULTANT',
      group_id: G_ATTACKER,
    });
    expect(err).toBeNull();
    expect(createInvitationSpy).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'CONSULTANT', groupId: G_REC }),
    );
  });

  it('RECRUITER with NO group_id cannot invite anyone (403 — invitee would land with NULL group, escaping every scope check)', async () => {
    // Previously a recruiter without a group_id would create a Consultant
    // with users.group_id = NULL, which escapes every group-scope check
    // downstream. The handler now refuses the invite up-front and instructs
    // the user to ask an admin to place them in a group.
    const { err } = await call(
      { ...RECRUITER, group_id: null },
      { email: 'c@x.test', role: 'CONSULTANT' },
    );
    expect(err?.status).toBe(403);
    expect((err as { message?: string }).message ?? '').toMatch(/assigned to a group/i);
    expect(createInvitationSpy).not.toHaveBeenCalled();
  });

  it('HR_MANAGER with NO group_id cannot invite either (same fail-closed rule, not recruiter-only)', async () => {
    const { err } = await call(
      { ...HR_LEAD, group_id: null },
      { email: 'r@x.test', role: 'RECRUITER' },
    );
    expect(err?.status).toBe(403);
    expect(createInvitationSpy).not.toHaveBeenCalled();
  });

  it('ADMIN-TIER (DIRECTOR) with no group_id ⇒ stays "no group" (admin chooses freely)', async () => {
    const { err } = await call(DIRECTOR, { email: 'c@x.test', role: 'CONSULTANT' });
    expect(err).toBeNull();
    expect(createInvitationSpy).toHaveBeenCalledWith(expect.objectContaining({ groupId: null }));
  });

  it('ADMIN-TIER with explicit group_id keeps it', async () => {
    const { err } = await call(DIRECTOR, {
      email: 'c@x.test',
      role: 'CONSULTANT',
      group_id: G_ANY,
    });
    expect(err).toBeNull();
    expect(createInvitationSpy).toHaveBeenCalledWith(expect.objectContaining({ groupId: G_ANY }));
  });

  it('RECRUITER inviting a non-CONSULTANT role is blocked by canAssignRole (403, no group default reached)', async () => {
    const { err } = await call(RECRUITER, { email: 'm@x.test', role: 'MANAGER' });
    expect(err?.status).toBe(403);
    expect(createInvitationSpy).not.toHaveBeenCalled();
  });
});
