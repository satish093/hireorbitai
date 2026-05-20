/**
 * Frontend type surface.
 *
 * Role + tier + Task enums come from `@hireorbitai/shared` — the single
 * source of truth for both halves of the monorepo. Any change to those
 * definitions goes in `shared/src/`; the workspace symlink makes them visible
 * here without a rebuild step in dev mode.
 *
 * This file also declares frontend-only domain shapes (UserProfile, Task UI
 * shapes, etc.) and the UI-facing label maps.
 */

// Explicit named re-exports (not `export *`) — Rollup's static analysis
// doesn't fully traverse `export *` chains through a CJS package main, so
// the bundler can throw "X is not exported" even though the types resolve.
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

import type { Role, TaskStatus, TaskPriority } from '@hireorbitai/shared';

/** UI label for a role — display capitalisation lives with the UI. */
export const ROLE_LABEL: Record<Role, string> = {
  SUPER_ADMIN: 'Super Admin',
  CEO: 'CEO',
  CTO: 'CTO',
  DIRECTOR: 'Director',
  MANAGER: 'Manager',
  HR_MANAGER: 'HR Manager',
  DEVELOPER: 'Developer',
  RECRUITER: 'Recruiter',
  CONSULTANT: 'Consultant',
};

/** UI label for a task status. */
export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  BACKLOG: 'Backlog',
  TODO: 'To Do',
  IN_PROGRESS: 'In Progress',
  BLOCKED: 'Blocked',
  REVIEW: 'Review',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

// ---------------------------------------------------------------------------
// Frontend-only domain shapes — used by pages / components, not by backend.
// ---------------------------------------------------------------------------

export interface UserProfile {
  id: string;
  email: string;
  full_name?: string;
  phone?: string;
  role: Role;
  avatar_url?: string;
  is_active: boolean;
  /** True when the user signed in with a temp password and must rotate it. */
  must_change_password?: boolean;
  /** Set when the user has completed the role-specific onboarding. */
  consultant_id?: string | null;
  recruiter_id?: string | null;
  /** Set once the user has seen (or skipped) the first-run product tour. */
  tour_completed_at?: string | null;
}

export type MarketingStatus = 'ACTIVE' | 'PAUSED' | 'PLACED';
export type ApplicationStatus =
  | 'SUBMITTED'
  | 'SCREENING'
  | 'INTERVIEW'
  | 'OFFER'
  | 'REJECTED'
  | 'WITHDRAWN';
export type InterviewType = 'PHONE' | 'TECHNICAL' | 'BEHAVIORAL' | 'ONSITE' | 'FINAL' | 'MOCK';
export type InterviewStatus = 'SCHEDULED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';

export interface Task {
  id: string;
  title: string;
  description?: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assignee_id?: string | null;
  created_by?: string | null;
  related_consultant_id?: string | null;
  related_recruiter_id?: string | null;
  due_at?: string | null;
  completed_at?: string | null;
  order_index?: number;
  tags?: string[] | null;
  created_at: string;
  updated_at: string;
  assignee?: {
    id: string;
    email: string;
    full_name?: string | null;
    role?: Role;
    group_id?: string | null;
  } | null;
  creator?: {
    id: string;
    email: string;
    full_name?: string | null;
    role?: Role;
    group_id?: string | null;
  } | null;
  consultant?: {
    id: string;
    user?: { full_name?: string | null; email: string; group_id?: string | null };
  } | null;
  recruiter?: {
    id: string;
    user?: { full_name?: string | null; email: string; group_id?: string | null };
  } | null;
}

export interface TaskComment {
  id: string;
  task_id: string;
  author_id?: string | null;
  body: string;
  created_at: string;
  author?: { id: string; email: string; full_name?: string | null } | null;
}

export interface TaskAttachment {
  id: string;
  task_id: string;
  file_name: string;
  storage_path: string;
  mime_type?: string | null;
  size_bytes?: number | null;
  uploaded_by?: string | null;
  created_at: string;
  download_url?: string | null;
  uploader?: { id: string; email: string; full_name?: string | null } | null;
}
