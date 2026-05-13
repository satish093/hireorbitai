export type Role =
  | 'SUPER_ADMIN' | 'CEO' | 'CTO' | 'DIRECTOR'
  | 'MANAGER' | 'HR_MANAGER' | 'DEVELOPER'
  | 'RECRUITER' | 'CONSULTANT';

/** Workspace owners — can toggle feature flags + irreversible workspace settings. */
export const OWNER_TIER: Role[] = ['SUPER_ADMIN', 'CEO'];
/** Roles with full-org visibility (everything an admin can do). */
export const ADMIN_TIER: Role[] = ['SUPER_ADMIN', 'CEO', 'CTO', 'DIRECTOR'];
/** Admin tier + people managers (incl. HR Manager) + internal Developer. */
export const MANAGER_TIER: Role[] = [...ADMIN_TIER, 'MANAGER', 'HR_MANAGER', 'DEVELOPER'];
/** Manager tier + Recruiter — operates on the talent pipeline. */
export const OPERATOR_TIER: Role[] = [...MANAGER_TIER, 'RECRUITER'];
/** Every authenticated role. */
export const ALL_ROLES: Role[] = [...OPERATOR_TIER, 'CONSULTANT'];

export function isAdmin(role: Role | undefined): boolean {
  return !!role && ADMIN_TIER.includes(role);
}
export function isManagerOrUp(role: Role | undefined): boolean {
  return !!role && MANAGER_TIER.includes(role);
}

export type TaskStatus =
  | 'BACKLOG' | 'TODO' | 'IN_PROGRESS' | 'BLOCKED' | 'REVIEW' | 'COMPLETED' | 'CANCELLED';
export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export const TASK_STATUSES: TaskStatus[] = [
  'BACKLOG', 'TODO', 'IN_PROGRESS', 'BLOCKED', 'REVIEW', 'COMPLETED', 'CANCELLED',
];
export const TASK_PRIORITIES: TaskPriority[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

export interface AuthUser {
  id: string;
  email: string;
  role: Role;
  group_id?: string | null;
  must_change_password?: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export interface ApiError extends Error {
  status?: number;
  details?: unknown;
}

export function httpError(status: number, message: string, details?: unknown): ApiError {
  const e = new Error(message) as ApiError;
  e.status = status;
  e.details = details;
  return e;
}
