/**
 * Centralized permission engine for hierarchy-aware messaging (and any future
 * feature that needs the same access-control semantics).
 *
 * Single source of truth for "can user A reach user B?" — every controller
 * that needs the answer calls into this module instead of re-implementing
 * the rules. Keeps the directory, send, thread, and read endpoints in
 * lockstep when a role-mapping change ships.
 *
 * Backed by the existing schema — no new tables. Reads from:
 *   - public.users.reports_to (org chart)
 *   - public.recruiter_managers (many-to-many recruiter → manager)
 *   - public.recruiters.manager_id (legacy single manager, still consulted
 *     for backwards compat with rows pre-migration)
 *   - public.consultants.recruiter_id (single recruiter per consultant)
 *   - public.users.group_id (per-org/team grouping)
 *
 * Performance: each call issues 3-5 small indexed queries against the above
 * tables. Fine for the current message-route volume; a future phase will
 * add a request-scoped cache + a denormalized user_relationships table to
 * cut this to a single index lookup.
 */

import { db } from '../config/db';
import { ADMIN_TIER, MANAGER_TIER, type Role } from '../types';

const MGR_ROLES = MANAGER_TIER as readonly Role[];
const ADMIN_ROLES = ADMIN_TIER as readonly Role[];

export interface PermissionCaller {
  id: string;
  role: Role;
}

/**
 * Returns the set of user IDs the caller is permitted to message.
 *
 * Rules:
 *   - Manager tier (incl. admin tier): every active user in the workspace
 *     minus self. This is the existing "directory shows everyone" behavior
 *     for managers/admins.
 *   - Recruiter: their consultants (via consultants.recruiter_id), their
 *     managers (recruiter_managers + legacy recruiters.manager_id), plus
 *     anyone in their reports-to chain.
 *   - Consultant: their recruiter, that recruiter's managers, plus anyone
 *     in their reports-to chain.
 *   - All non-admin roles also include anyone they have already exchanged
 *     messages with — legitimacy via prior thread, so a recruiter assignment
 *     change doesn't suddenly kill in-flight conversations.
 *
 * Self is never included in the returned set even if any branch above would
 * have added it.
 */
export async function getAccessibleUserIds(caller: PermissionCaller): Promise<Set<string>> {
  // Manager tier sees the whole workspace. Admin tier is a subset of
  // manager tier so this also covers admin override.
  if (MGR_ROLES.includes(caller.role)) {
    const { data } = await db
      .from('users')
      .select('id')
      .neq('id', caller.id)
      .neq('is_active', false);
    return new Set((data ?? []).map((u: { id: string }) => u.id));
  }

  const peerIds = new Set<string>();

  // Recruiter: my consultants + my managers (both legacy + junction table).
  if (caller.role === 'RECRUITER') {
    const { data: myRec } = await db
      .from('recruiters')
      .select('id, manager_id')
      .eq('user_id', caller.id)
      .maybeSingle();
    const recRow = myRec as { id?: string; manager_id?: string | null } | null;
    if (recRow?.id) {
      // Legacy single-manager column (still populated on older rows).
      if (recRow.manager_id) peerIds.add(recRow.manager_id);
      // Many-to-many junction (canonical going forward).
      const { data: mgrs } = await db
        .from('recruiter_managers')
        .select('manager_id')
        .eq('recruiter_id', recRow.id);
      for (const m of (mgrs ?? []) as Array<{ manager_id: string }>) {
        if (m.manager_id) peerIds.add(m.manager_id);
      }
      // My consultants — by consultants.recruiter_id → consultants.user_id.
      const { data: cons } = await db
        .from('consultants')
        .select('user_id')
        .eq('recruiter_id', recRow.id);
      for (const c of (cons ?? []) as Array<{ user_id: string | null }>) {
        if (c.user_id) peerIds.add(c.user_id);
      }
    }
  }

  // Consultant: my recruiter + that recruiter's managers.
  if (caller.role === 'CONSULTANT') {
    const { data: me } = await db
      .from('consultants')
      .select('recruiter_id')
      .eq('user_id', caller.id)
      .maybeSingle();
    const cRow = me as { recruiter_id?: string | null } | null;
    if (cRow?.recruiter_id) {
      const { data: rec } = await db
        .from('recruiters')
        .select('id, user_id, manager_id')
        .eq('id', cRow.recruiter_id)
        .maybeSingle();
      const recRow = rec as {
        id?: string;
        user_id?: string | null;
        manager_id?: string | null;
      } | null;
      if (recRow?.user_id) peerIds.add(recRow.user_id);
      if (recRow?.manager_id) peerIds.add(recRow.manager_id);
      if (recRow?.id) {
        const { data: mgrs } = await db
          .from('recruiter_managers')
          .select('manager_id')
          .eq('recruiter_id', recRow.id);
        for (const m of (mgrs ?? []) as Array<{ manager_id: string }>) {
          if (m.manager_id) peerIds.add(m.manager_id);
        }
      }
    }
  }

  // Reports-to chain (both directions) applies to every non-manager role.
  // The chain is an explicit users.reports_to FK; following it up gives the
  // direct manager, following it down gives subordinates.
  const { data: meUser } = await db
    .from('users')
    .select('reports_to')
    .eq('id', caller.id)
    .maybeSingle();
  const u = meUser as { reports_to?: string | null } | null;
  if (u?.reports_to) peerIds.add(u.reports_to);
  const { data: directReports } = await db.from('users').select('id').eq('reports_to', caller.id);
  for (const r of (directReports ?? []) as Array<{ id: string }>) {
    if (r.id) peerIds.add(r.id);
  }

  // Legitimacy carry-over: anyone the caller has previously exchanged a
  // message with stays reachable. Without this, reassigning a recruiter
  // would silently break every in-flight conversation between that
  // recruiter and their old consultants — confusing and inconsistent with
  // every other chat product. This is also what the existing directory()
  // logic does so behavior stays uniform.
  const { data: existing } = await db
    .from('messages')
    .select('sender_id, recipient_id')
    .or(`sender_id.eq.${caller.id},recipient_id.eq.${caller.id}`);
  for (const m of (existing ?? []) as Array<{ sender_id: string; recipient_id: string }>) {
    if (m.sender_id !== caller.id) peerIds.add(m.sender_id);
    if (m.recipient_id !== caller.id) peerIds.add(m.recipient_id);
  }

  peerIds.delete(caller.id);
  return peerIds;
}

/**
 * Cheaper variant when the caller only needs to check ONE target id — short-
 * circuits on the admin-tier branch (no big users SELECT) and the existing-
 * message branch (one EXISTS query).
 *
 * Falls back to `getAccessibleUserIds` for the general case.
 */
export async function canMessageUser(caller: PermissionCaller, targetId: string): Promise<boolean> {
  if (!targetId || caller.id === targetId) return false;
  if (ADMIN_ROLES.includes(caller.role) || MGR_ROLES.includes(caller.role)) {
    // Manager-tier can message any active user. Cheap existence check.
    const { data } = await db
      .from('users')
      .select('id, is_active')
      .eq('id', targetId)
      .maybeSingle();
    const t = data as { id?: string; is_active?: boolean | null } | null;
    return !!t?.id && t.is_active !== false;
  }
  // Fast-path for the recipient already being a known thread participant —
  // saves the full hierarchy resolution on the common "reply to existing
  // conversation" path.
  const { count: priorCount } = await db
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .or(
      `and(sender_id.eq.${caller.id},recipient_id.eq.${targetId}),` +
        `and(sender_id.eq.${targetId},recipient_id.eq.${caller.id})`,
    );
  if ((priorCount ?? 0) > 0) return true;

  // Slow path: full hierarchy lookup.
  const allowed = await getAccessibleUserIds(caller);
  return allowed.has(targetId);
}

/**
 * Alias kept for parity with the spec — viewing a user (e.g. to show their
 * avatar in a UI surface) requires the same permission as messaging them.
 */
export async function canViewUser(caller: PermissionCaller, targetId: string): Promise<boolean> {
  return canMessageUser(caller, targetId);
}

/**
 * Alias — starting a conversation IS messaging them; same check.
 */
export async function canStartConversation(
  caller: PermissionCaller,
  targetId: string,
): Promise<boolean> {
  return canMessageUser(caller, targetId);
}

/**
 * Same as canMessageUser but explicitly named for thread-fetch callsites —
 * makes denied-access audit metadata cleaner ("reason: cannot view
 * conversation" vs "cannot send message").
 */
export async function canViewConversation(
  caller: PermissionCaller,
  peerId: string,
): Promise<boolean> {
  return canMessageUser(caller, peerId);
}
