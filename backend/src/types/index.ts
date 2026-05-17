/**
 * Backend type surface.
 *
 * Role + tier + Task enums come from `@hireorbitai/shared` — the single
 * source of truth for both halves of the monorepo. Any change to those
 * definitions goes in `shared/src/`; both backend and frontend pick it up
 * automatically on the next `npm run shared:build`.
 *
 * This file also declares backend-only types: `AuthUser`, the `Express.Request`
 * augmentation, the `ApiError` envelope, and the `httpError(status, msg)`
 * helper used by every controller and middleware.
 */

// Canonical types — re-exported from the workspace package so callers can
// continue to `import { Role, MANAGER_TIER } from '../types'`.
// Named exports (not `export *`) match the frontend pattern + are more robust
// across bundlers that don't traverse `export *` through a CJS package main.
export {
  OWNER_TIER,
  ADMIN_TIER,
  MANAGER_TIER,
  OPERATOR_TIER,
  ALL_ROLES,
  TASK_STATUSES,
  TASK_PRIORITIES,
  isAdmin,
  isManagerOrUp,
} from '@hireorbitai/shared';
export type { Role, TaskStatus, TaskPriority } from '@hireorbitai/shared';

import type { Role } from '@hireorbitai/shared';

export interface AuthUser {
  id: string;
  email: string;
  role: Role;
  group_id?: string | null;
  must_change_password?: boolean;
}

declare global {
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
