/**
 * Canonical invitation hierarchy logic.
 *
 * Rank-based flexible hierarchy:
 *   CONSULTANT  → RECRUITER  (rank ≥ 2) — MANAGER / HR_MANAGER / admin-tier all valid too
 *   RECRUITER   → MANAGER    (rank ≥ 4) — HR_MANAGER / admin-tier also valid
 *   MANAGER     → HR_MANAGER (rank ≥ 5) — admin-tier also valid
 *   HR_MANAGER  → DIRECTOR   (rank ≥ 6) — CTO / CEO / SUPER_ADMIN also valid
 *   DEVELOPER   → MANAGER    (rank ≥ 4) — HR_MANAGER / admin-tier also valid
 *
 * Admin-tier roles (SUPER_ADMIN, CEO, CTO, DIRECTOR) require no parent.
 *
 * Auto-assignment algorithm (in order):
 *   1. Inviter rank ≥ required parent rank → inviter becomes the parent.
 *   2. Walk inviter's hierarchy upward (reports_to + recruiter_managers)
 *      until a user with sufficient rank is found.
 *   3. Workspace search: if exactly one active user holds the default parent
 *      role → auto-assign.  Multiple or zero → null (manual selection needed).
 *
 * Manual override: SUPER_ADMIN may bypass hierarchy entirely by setting
 * manual_override=true on the invitation request.  Lower roles can manually
 * choose any parent that passes isAllowedParent() within their authority.
 */

import { db } from '../config/db';
import type { Role } from '../types';

// ---------------------------------------------------------------------------
// Rank table — single source of truth for authority ordering
// ---------------------------------------------------------------------------

export const ROLE_RANK: Record<Role, number> = {
  SUPER_ADMIN: 9,
  CEO: 8,
  CTO: 7,
  DIRECTOR: 6,
  HR_MANAGER: 5,
  MANAGER: 4,
  DEVELOPER: 3,
  RECRUITER: 2,
  CONSULTANT: 1,
};

/**
 * Minimum-rank parent role for each invited role.
 * Admin-tier roles are absent — they need no parent.
 */
const DEFAULT_PARENT_ROLE: Partial<Record<Role, Role>> = {
  CONSULTANT: 'RECRUITER', // rank 2 minimum
  RECRUITER: 'MANAGER', // rank 4 minimum
  MANAGER: 'HR_MANAGER', // rank 5 minimum
  HR_MANAGER: 'DIRECTOR', // rank 6 minimum (lowest admin-tier above HR_MANAGER)
  DEVELOPER: 'MANAGER', // rank 4 minimum
};

// ---------------------------------------------------------------------------
// Pure rank helpers
// ---------------------------------------------------------------------------

export function getRoleRank(role: Role): number {
  return ROLE_RANK[role] ?? 0;
}

export function isHigherThan(roleA: Role, roleB: Role): boolean {
  return getRoleRank(roleA) > getRoleRank(roleB);
}

/** Actor strictly outranks target. */
export function canManageRole(actorRole: Role, targetRole: Role): boolean {
  return getRoleRank(actorRole) > getRoleRank(targetRole);
}

// ---------------------------------------------------------------------------
// Parent-role helpers
// ---------------------------------------------------------------------------

/** Returns the default (minimum) parent role for an invited role, or null for admin-tier. */
export function getDefaultParentRole(invitedRole: Role): Role | null {
  return DEFAULT_PARENT_ROLE[invitedRole] ?? null;
}

/**
 * Any role whose rank ≥ the default parent's rank is a valid parent.
 * For admin-tier invited roles (no parent required) always returns true.
 */
export function isAllowedParent(invitedRole: Role, parentRole: Role): boolean {
  const defaultParent = getDefaultParentRole(invitedRole);
  if (!defaultParent) return true; // admin-tier: no parent required
  return getRoleRank(parentRole) >= getRoleRank(defaultParent);
}

/** Backward-compat alias — delegates to isAllowedParent. */
export function isValidParentRole(invitedRole: Role, parentRole: Role): boolean {
  return isAllowedParent(invitedRole, parentRole);
}

/**
 * Returns the default parent role as a single-item array for error messages.
 * Returns null for admin-tier roles that need no parent.
 */
export function getExpectedParentRoles(invitedRole: Role): Role[] | null {
  const def = getDefaultParentRole(invitedRole);
  return def ? [def] : null;
}

/**
 * Returns every role whose rank satisfies the parent requirement for invitedRole.
 * Used to build the candidates list in availableParents.
 */
export function getAllValidParentRoles(invitedRole: Role): Role[] | null {
  const defaultParent = getDefaultParentRole(invitedRole);
  if (!defaultParent) return null;
  const minRank = getRoleRank(defaultParent);
  return (Object.keys(ROLE_RANK) as Role[]).filter((r) => getRoleRank(r) >= minRank);
}

/**
 * The inviter can become the parent if their rank ≥ the minimum required parent rank.
 */
export function canInviterBecomeParent(invitedRole: Role, inviterRole: Role): boolean {
  return isAllowedParent(invitedRole, inviterRole);
}

/**
 * Can the actor manually choose chosenParentRole as the parent for invitedRole?
 *   SUPER_ADMIN: always yes.
 *   Others: the chosen parent must pass isAllowedParent AND the actor must
 *           outrank the invited role.
 */
export function canManualOverride(
  actorRole: Role,
  invitedRole: Role,
  chosenParentRole: Role,
): boolean {
  if (actorRole === 'SUPER_ADMIN') return true;
  if (!isAllowedParent(invitedRole, chosenParentRole)) return false;
  return canManageRole(actorRole, invitedRole);
}

// ---------------------------------------------------------------------------
// Async resolution helpers
// ---------------------------------------------------------------------------

/**
 * Server-side auto-parent resolution.  Never call this from the frontend.
 *
 * Resolution order:
 *   1. Inviter rank ≥ default parent rank → inviter is the parent.
 *   2. Walk inviter's hierarchy upward (reports_to + recruiter_managers)
 *      until a user with sufficient rank is found.
 *   3. Workspace search: if exactly one active user holds the default parent
 *      role → auto-assign.  Multiple or zero → return null.
 */
export async function resolveAutoParent(
  invitedRole: Role,
  inviter: { id: string; role: Role },
): Promise<string | null> {
  const defaultParent = getDefaultParentRole(invitedRole);
  if (!defaultParent) return null; // admin-tier: no parent needed

  // Case 1: inviter rank ≥ required parent rank → inviter becomes the parent
  if (canInviterBecomeParent(invitedRole, inviter.role)) return inviter.id;

  // Case 2: walk inviter's hierarchy upward
  const walked = await _findParentUpHierarchy(inviter.id, defaultParent);
  if (walked) return walked;

  // Case 3: workspace search — auto-assign only when exactly one candidate
  const { data } = await db
    .from('users')
    .select('id')
    .eq('role', defaultParent as string)
    .eq('is_active', true);
  const candidates = (data ?? []) as Array<{ id: string }>;
  if (candidates.length === 1) return candidates[0]!.id;

  return null;
}

/** Walk up the org tree from userId, returning the first user with rank ≥ minRank. */
async function _findParentUpHierarchy(
  userId: string,
  defaultParentRole: Role,
): Promise<string | null> {
  const minRank = getRoleRank(defaultParentRole);

  // reports_to chain (managers, HR managers, etc.)
  const { data: user } = await db.from('users').select('reports_to').eq('id', userId).maybeSingle();
  const reportsTo = (user as { reports_to?: string | null } | null)?.reports_to;
  if (reportsTo) {
    const { data: parent } = await db
      .from('users')
      .select('id, role')
      .eq('id', reportsTo)
      .maybeSingle();
    const p = parent as { id: string; role: Role } | null;
    if (p && getRoleRank(p.role) >= minRank) return p.id;
  }

  // For recruiters: check legacy manager_id on recruiters row
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
    if (m && getRoleRank(m.role) >= minRank) return m.id;
  }

  // For recruiters: check recruiter_managers junction
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
      if (m && getRoleRank(m.role) >= minRank) return m.id;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Hierarchy wiring (called after account creation)
// ---------------------------------------------------------------------------

/**
 * Wires the new user into the org hierarchy based on their invited role and
 * the designated parent.  Called after the user row exists.
 *
 * Non-fatal by design — callers wrap this in try/catch so a missing profile
 * row or unapplied migration doesn't break the account-creation path.
 */
export async function wireHierarchy(
  newUserId: string,
  invitedRole: Role,
  parentUserId: string | null,
): Promise<void> {
  if (!parentUserId) return;

  if (invitedRole === 'CONSULTANT') {
    // Attempt to wire consultant → recruiter row if parent is a recruiter
    const { data: rec } = await db
      .from('recruiters')
      .select('id')
      .eq('user_id', parentUserId)
      .maybeSingle();
    const recRow = rec as { id: string } | null;
    if (recRow) {
      try {
        await db
          .from('consultants')
          .upsert({ user_id: newUserId, recruiter_id: recRow.id }, { onConflict: 'user_id' });
      } catch {
        // parent may not be a recruiter (e.g. manager as parent) — graceful skip
      }
    }
    await db.from('users').update({ reports_to: parentUserId }).eq('id', newUserId);
  } else if (invitedRole === 'RECRUITER') {
    // Create / update the recruiter's profile row
    const { data: rec } = await db
      .from('recruiters')
      .upsert({ user_id: newUserId, manager_id: parentUserId }, { onConflict: 'user_id' })
      .select('id')
      .single();
    const recRow = rec as { id: string } | null;
    if (recRow) {
      try {
        await db
          .from('recruiter_managers')
          .upsert(
            { recruiter_id: recRow.id, manager_id: parentUserId, is_primary: true },
            { onConflict: 'recruiter_id,manager_id' },
          );
      } catch {
        // recruiter_managers migration may not be applied yet — graceful degradation
      }
    }
    await db.from('users').update({ reports_to: parentUserId }).eq('id', newUserId);
  } else {
    // MANAGER, HR_MANAGER, DEVELOPER — set reports_to only
    await db.from('users').update({ reports_to: parentUserId }).eq('id', newUserId);
  }
}
