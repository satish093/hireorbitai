/**
 * Canonical invitation hierarchy logic.
 *
 * Single source of truth for:
 *   - Which parent roles are valid for each invited role
 *   - Automatic parent resolution from the inviter's position in the org tree
 *   - Wiring hierarchy relationships (consultants.recruiter_id,
 *     recruiter_managers, users.reports_to) when an invitation is accepted
 *
 * Pure functions (getExpectedParentRoles, isValidParentRole) are unit-testable
 * without DB access. Async functions (resolveAutoParent, wireHierarchy) receive
 * the db shim so they can be mocked in tests.
 */

import { db } from '../config/db';
import type { Role } from '../types';

/**
 * Maps an invited role to the set of roles that are valid parents.
 * ADMIN_TIER roles are intentionally absent — they don't require a parent.
 */
export const PARENT_ROLE_MAP: Partial<Record<Role, Role[]>> = {
  CONSULTANT: ['RECRUITER'],
  RECRUITER: ['MANAGER', 'HR_MANAGER', 'DIRECTOR', 'CTO', 'CEO', 'SUPER_ADMIN'],
  MANAGER: ['HR_MANAGER', 'DIRECTOR', 'CTO', 'CEO', 'SUPER_ADMIN'],
  HR_MANAGER: ['DIRECTOR', 'CTO', 'CEO', 'SUPER_ADMIN'],
  DEVELOPER: ['MANAGER', 'HR_MANAGER', 'DIRECTOR', 'CTO', 'CEO', 'SUPER_ADMIN'],
};

/** Returns the expected parent roles for an invited role, or null if no parent is needed. */
export function getExpectedParentRoles(invitedRole: Role): Role[] | null {
  return PARENT_ROLE_MAP[invitedRole] ?? null;
}

/** Returns true if parentRole is a valid parent for invitedRole. */
export function isValidParentRole(invitedRole: Role, parentRole: Role): boolean {
  const expected = getExpectedParentRoles(invitedRole);
  if (!expected) return true; // no parent required for admin-tier roles
  return expected.includes(parentRole);
}

/**
 * Tries to determine the correct parent user automatically.
 *
 * Resolution order:
 *   1. If the inviter's own role is in the expected parent roles → inviter is the parent.
 *   2. Otherwise walk the inviter's hierarchy upward — first via users.reports_to,
 *      then via recruiter_managers / recruiters.manager_id — until a user with an
 *      expected parent role is found.
 *   3. If none is found → returns null (caller must require manual selection).
 */
export async function resolveAutoParent(
  invitedRole: Role,
  inviter: { id: string; role: Role },
): Promise<string | null> {
  const expected = getExpectedParentRoles(invitedRole);
  if (!expected) return null; // no parent needed

  // Case 1: inviter IS the right kind of parent
  if (expected.includes(inviter.role)) return inviter.id;

  // Case 2: inviter is above the expected tier → walk up their hierarchy
  return _findParentUpHierarchy(inviter.id, expected);
}

/** Walk up the org tree from userId to find the first user with one of expectedRoles. */
async function _findParentUpHierarchy(
  userId: string,
  expectedRoles: Role[],
): Promise<string | null> {
  // Check reports_to chain (works for managers whose HR mgr is set)
  const { data: user } = await db.from('users').select('reports_to').eq('id', userId).maybeSingle();
  const reportsTo = (user as { reports_to?: string | null } | null)?.reports_to;
  if (reportsTo) {
    const { data: parent } = await db
      .from('users')
      .select('id, role')
      .eq('id', reportsTo)
      .maybeSingle();
    const p = parent as { id: string; role: Role } | null;
    if (p && expectedRoles.includes(p.role)) return p.id;
  }

  // For recruiters: check legacy manager_id + recruiter_managers junction
  const { data: rec } = await db
    .from('recruiters')
    .select('id, manager_id')
    .eq('user_id', userId)
    .maybeSingle();
  const recRow = rec as { id?: string; manager_id?: string | null } | null;

  if (recRow?.manager_id) {
    const { data: mgr } = await db
      .from('users')
      .select('id, role')
      .eq('id', recRow.manager_id)
      .maybeSingle();
    const m = mgr as { id: string; role: Role } | null;
    if (m && expectedRoles.includes(m.role)) return m.id;
  }

  if (recRow?.id) {
    const { data: junction } = await db
      .from('recruiter_managers')
      .select('manager_id')
      .eq('recruiter_id', recRow.id)
      .limit(1);
    const mgrs = (junction ?? []) as Array<{ manager_id: string }>;
    if (mgrs.length > 0) {
      const { data: mgr } = await db
        .from('users')
        .select('id, role')
        .eq('id', mgrs[0]!.manager_id)
        .maybeSingle();
      const m = mgr as { id: string; role: Role } | null;
      if (m && expectedRoles.includes(m.role)) return m.id;
    }
  }

  return null;
}

/**
 * Wires the new user into the org hierarchy based on their invited role and
 * the designated parent. Called from both the setup (new account) and accept
 * (role-upgrade) flows after the user row exists.
 *
 * Failures are intentionally non-fatal — the outer caller wraps this in a
 * try/catch so a missing profile row or unapplied migration doesn't break the
 * account-creation path. The user is created correctly; admins can manually
 * fix the hierarchy if needed.
 */
export async function wireHierarchy(
  newUserId: string,
  invitedRole: Role,
  parentUserId: string | null,
): Promise<void> {
  if (!parentUserId) return;

  if (invitedRole === 'CONSULTANT') {
    // Find the parent's recruiters row to get the recruiter UUID
    const { data: rec } = await db
      .from('recruiters')
      .select('id')
      .eq('user_id', parentUserId)
      .maybeSingle();
    const recRow = rec as { id: string } | null;
    if (recRow) {
      await db
        .from('consultants')
        .upsert({ user_id: newUserId, recruiter_id: recRow.id }, { onConflict: 'user_id' });
    }
    await db.from('users').update({ reports_to: parentUserId }).eq('id', newUserId);
  } else if (invitedRole === 'RECRUITER') {
    // Create or update the recruiters profile row
    const { data: rec } = await db
      .from('recruiters')
      .upsert({ user_id: newUserId, manager_id: parentUserId }, { onConflict: 'user_id' })
      .select('id')
      .single();
    const recRow = rec as { id: string } | null;
    if (recRow) {
      // Wire the recruiter_managers junction (is_primary = true for the first manager)
      try {
        await db
          .from('recruiter_managers')
          .upsert(
            { recruiter_id: recRow.id, manager_id: parentUserId, is_primary: true },
            { onConflict: 'recruiter_id,manager_id' },
          );
      } catch {
        // Migration may not be applied yet — graceful degradation
      }
    }
    await db.from('users').update({ reports_to: parentUserId }).eq('id', newUserId);
  } else {
    // MANAGER, HR_MANAGER, DEVELOPER — set reports_to only
    await db.from('users').update({ reports_to: parentUserId }).eq('id', newUserId);
  }
}
