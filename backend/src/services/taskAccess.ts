/**
 * Centralized task-access guard. Replaces the per-controller "isManagerLike →
 * allow everything" checks in tasks / taskComments / taskAttachments that
 * silently let a group lead (HR_MANAGER / MANAGER) read, list, or delete
 * tasks (and their comments / attachments / signed URLs) outside their
 * own group.
 *
 * Rules:
 *
 *   ADMIN_TIER (SUPER_ADMIN, CEO, CTO, DIRECTOR)
 *     → access every task. Workspace-wide oversight, no group scoping.
 *
 *   GROUP LEAD (HR_MANAGER, MANAGER)
 *     → access if the caller is the assignee OR the creator (self-touched
 *       task — always allowed), OR if the assignee user is in the caller's
 *       group, OR if the creator user is in the caller's group.
 *     A lead with no group_id is fail-closed for the group branches
 *     (only self-touched tasks remain accessible).
 *
 *   RECRUITER / CONSULTANT / DEVELOPER (non-manager)
 *     → access only if the caller is the assignee OR the creator.
 *
 * Throws httpError(404, 'Task not found') on a missing task OR a denied
 * access, so the endpoint can't double as an existence oracle.
 */

import { db } from '../config/db';
import { httpError, ADMIN_TIER, GROUP_LEAD_ROLES, type Role } from '../types';
import { leadCanAccessUser } from './groupScope';

export interface TaskAccessCaller {
  id: string;
  role: Role;
  group_id?: string | null;
}

/** Lean shape returned by `assertCanAccessTask` so callers don't re-fetch. */
export interface AccessibleTask {
  id: string;
  assignee_id: string | null;
  created_by: string | null;
}

function isAdmin(role: Role): boolean {
  return (ADMIN_TIER as Role[]).includes(role);
}

function isGroupLead(role: Role): boolean {
  return (GROUP_LEAD_ROLES as Role[]).includes(role);
}

/**
 * Asserts the caller can access the task. Returns the task row on success;
 * throws 404 on missing / denied. Use this on every task surface — get,
 * update, status, delete, comments, attachments, subtasks, activity.
 */
export async function assertCanAccessTask(
  caller: TaskAccessCaller,
  taskId: string,
): Promise<AccessibleTask> {
  const { data, error } = await db
    .from('tasks')
    .select('id, assignee_id, created_by')
    .eq('id', taskId)
    .maybeSingle();
  if (error) throw httpError(500, 'Database error');
  const task = data as AccessibleTask | null;
  if (!task) throw httpError(404, 'Task not found');

  // Admin-tier is unscoped.
  if (isAdmin(caller.role)) return task;

  // Self-touched (assignee or creator) — always allowed for any role.
  if (task.assignee_id === caller.id || task.created_by === caller.id) return task;

  // Group lead: allowed if either party is in their group.
  if (isGroupLead(caller.role)) {
    if (task.assignee_id && (await leadCanAccessUser(caller, task.assignee_id))) return task;
    if (task.created_by && (await leadCanAccessUser(caller, task.created_by))) return task;
  }

  // Everyone else (and a lead whose group doesn't cover either party) → denied.
  // 404 (not 403) so the endpoint can't be used as a task-id existence oracle.
  throw httpError(404, 'Task not found');
}

/**
 * Boolean variant of the same check — used by handlers that want to gate a
 * cheaper response (e.g. cached read) without throwing. Mirrors
 * assertCanAccessTask but returns false instead of throwing.
 */
export async function canAccessTask(caller: TaskAccessCaller, taskId: string): Promise<boolean> {
  try {
    await assertCanAccessTask(caller, taskId);
    return true;
  } catch {
    return false;
  }
}

/**
 * Authorisation for deleting a task COMMENT or ATTACHMENT that the caller does
 * NOT own. (Owner-delete is checked at the call site — every controller lets
 * the author/uploader delete their own item without going through this.)
 *
 * The rule, intentionally stricter than `assertCanAccessTask`:
 *
 *   ADMIN_TIER  → may delete any task child.
 *   GROUP LEAD  → may delete only when the parent task is in their group
 *                 (assertCanAccessTask covers this — admin unscoped, lead
 *                 in-group, self-touched).
 *   Everyone else (including a plain RECRUITER or CONSULTANT who is the task
 *   assignee or creator) → DENIED. Being the task's assignee/creator lets you
 *   read the comment and add your own, not delete someone else's contribution.
 *
 * Throws httpError(403) on denial — this is an authorisation refusal, not an
 * existence oracle; the caller already loaded the child row and is acting on
 * a known id.
 */
export async function assertCanDeleteTaskChild(
  caller: TaskAccessCaller,
  taskId: string,
): Promise<void> {
  if (isAdmin(caller.role)) return;
  if (isGroupLead(caller.role)) {
    // assertCanAccessTask already enforces "lead may only act on tasks whose
    // assignee/creator is in their group, OR a task they personally touch."
    // Either way we want the same group boundary here.
    await assertCanAccessTask(caller, taskId);
    return;
  }
  throw httpError(403, 'Forbidden');
}
