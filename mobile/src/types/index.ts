/**
 * Mobile type surface.
 *
 * Roles, tiers and the task enums come from `@hireorbitai/shared` — the SAME
 * package the backend and the web frontend import. That is the whole point of
 * choosing React Native: `canAssignRole`, `roleRank`, `OPERATOR_TIER` and
 * friends are one implementation shared by all three clients, so the app's
 * role logic cannot drift from the server's.
 *
 * Explicit named re-exports (not `export *`) mirror the web's file — Metro,
 * like Rollup, does not reliably traverse `export *` chains through a CJS
 * package main.
 *
 * Everything below the re-export block is a mobile-facing domain shape and is
 * kept identical to frontend/src/types/index.ts so screens port cleanly.
 */

export {
  OWNER_TIER,
  ADMIN_TIER,
  MANAGER_TIER,
  OPERATOR_TIER,
  ALL_ROLES,
  GROUP_LEAD_ROLES,
  ROLE_ORDER,
  BUSINESS_ROLES,
  MESSAGING_ROLES,
  SUPER_ADMIN_ONLY_ROLES,
  DEVELOPER_CAPABILITIES,
  PAGE_ACCESS_CAPABILITIES,
  ALL_CAPABILITIES,
  isPageAccessCapability,
  TASK_STATUSES,
  TASK_PRIORITIES,
  isAdmin,
  isManagerOrUp,
  roleRank,
  outranks,
  canAssignRole,
  assignableRolesFor,
} from '@hireorbitai/shared';

export type {
  Role,
  DeveloperCapability,
  PageAccessCapability,
  Capability,
  TaskStatus,
  TaskPriority,
} from '@hireorbitai/shared';

import type { Role, DeveloperCapability, TaskStatus, TaskPriority } from '@hireorbitai/shared';
import { isPageAccessCapability as _isPageAccessCap } from '@hireorbitai/shared';

/** UI label for a role — display capitalisation is a UI concern. */
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
// Domain shapes
// ---------------------------------------------------------------------------

export interface UserProfile {
  id: string;
  email: string;
  full_name?: string;
  phone?: string;
  role: Role;
  avatar_url?: string;
  is_active: boolean;
  group_id?: string | null;
  /** True when the user signed in with a temp password and must rotate it. */
  must_change_password?: boolean;
  /** Set when the user has completed the role-specific onboarding. */
  consultant_id?: string | null;
  recruiter_id?: string | null;
  tour_completed_at?: string | null;
  job_alerts?: boolean;
  capabilities?: DeveloperCapability[];
  first_name?: string | null;
  last_name?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  country?: string | null;
  timezone?: string | null;
  linkedin_url?: string | null;
}

/**
 * True when the profile holds the given capability grant.
 *   - PAGE_ACCESS capabilities, when defined, apply to ANY role.
 *   - DEVELOPER admin capabilities apply ONLY to a DEVELOPER account.
 *
 * Identical semantics to backend/src/middleware/auth.ts `hasCapability` — the
 * app must never be more permissive than the server.
 */
export function hasCapability(
  profile: Pick<UserProfile, 'role' | 'capabilities'> | null | undefined,
  cap: DeveloperCapability,
): boolean {
  if (!profile || !(profile.capabilities ?? []).includes(cap)) return false;
  return _isPageAccessCap(cap) || profile.role === 'DEVELOPER';
}

export type MarketingStatus = 'ACTIVE' | 'PAUSED' | 'PLACED' | 'DEACTIVATED';

export type ApplicationStatus =
  | 'SUBMITTED'
  | 'SCREENING'
  | 'INTERVIEW'
  | 'OFFER'
  | 'REJECTED'
  | 'WITHDRAWN';

export type InterviewType = 'PHONE' | 'TECHNICAL' | 'BEHAVIORAL' | 'ONSITE' | 'FINAL' | 'MOCK';
export type InterviewStatus = 'SCHEDULED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';

export interface UserRef {
  id: string;
  email: string;
  full_name?: string | null;
  role?: Role;
  group_id?: string | null;
  avatar_url?: string | null;
  phone?: string | null;
}

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
  assignee?: UserRef | null;
  creator?: UserRef | null;
  consultant?: { id: string; user?: Partial<UserRef> } | null;
  recruiter?: { id: string; user?: Partial<UserRef> } | null;
}

export interface TaskComment {
  id: string;
  task_id: string;
  author_id?: string | null;
  body: string;
  created_at: string;
  author?: UserRef | null;
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
  uploader?: UserRef | null;
}

export interface Job {
  id: string;
  title: string;
  company_name?: string | null;
  location?: string | null;
  description?: string | null;
  source?: string | null;
  publisher?: string | null;
  apply_url?: string | null;
  employment_type?: string | null;
  seniority?: string | null;
  salary_min?: number | null;
  salary_max?: number | null;
  posted_at?: string | null;
  created_at: string;
  is_remote?: boolean | null;
  skills?: string[] | null;
  // Resume-aware match fields — present on /jobs/recommended when a consultant
  // is targeted (consultant_id + min_match). Absent otherwise.
  match_score?: number | null;
  match_why?: string | null;
  match_matched_skills?: string[] | null;
  match_missing_skills?: string[] | null;
  // Saved/applied state.
  liked?: boolean | null;
  application_id?: string | null;
  application_status?: string | null;
}

export interface Application {
  id: string;
  job_id?: string | null;
  consultant_id?: string | null;
  recruiter_id?: string | null;
  status: ApplicationStatus;
  applied_at?: string | null;
  notes?: string | null;
  ats_score?: number | null;
  created_at: string;
  updated_at: string;
  job?: Partial<Job> | null;
  consultant?: { id: string; user?: Partial<UserRef> } | null;
}

export interface Interview {
  id: string;
  application_id?: string | null;
  consultant_id?: string | null;
  interview_type: InterviewType;
  status: InterviewStatus;
  scheduled_at?: string | null;
  duration_minutes?: number | null;
  location?: string | null;
  notes?: string | null;
  feedback?: string | null;
  created_at: string;
}

export interface Message {
  id: string;
  sender_id: string;
  recipient_id: string;
  body: string;
  read_at?: string | null;
  edited_at?: string | null;
  deleted_at?: string | null;
  reply_to_id?: string | null;
  is_internal_note?: boolean | null;
  created_at: string;
  sender?: UserRef | null;
  attachments?: MessageAttachment[] | null;
}

export interface MessageAttachment {
  id: string;
  message_id?: string | null;
  file_name: string;
  mime_type?: string | null;
  size_bytes?: number | null;
  download_url?: string | null;
  created_at: string;
}

export interface Conversation {
  peer: UserRef;
  last_message?: Message | null;
  unread_count: number;
}

export interface Consultant {
  id: string;
  user_id?: string | null;
  recruiter_id?: string | null;
  marketing_status?: MarketingStatus | null;
  visa_status?: string | null;
  skills?: string[] | null;
  desired_positions?: string[] | null;
  onboarded_at?: string | null;
  created_at: string;
  user?: UserRef | null;
  // Extended profile columns (consultants.* — the API returns these; the detail
  // view surfaces them, mirroring the web's Consultants drawer + row).
  primary_skill?: string | null;
  total_experience_years?: number | string | null;
  current_location?: string | null;
  preferred_locations?: string[] | null;
  // NUMERIC/BIGINT come back as STRINGS via node-postgres — coerce before math.
  expected_rate?: number | string | null;
  linkedin_url?: string | null;
  github_url?: string | null;
  portfolio_url?: string | null;
  relocation?: boolean | null;
  remote_only?: boolean | null;
  notes?: string | null;
  /** The recruiter this consultant is assigned to (embedded join). */
  recruiter?: { id: string; team?: string | null; user?: UserRef | null } | null;
}

/** One recruiter→manager edge from the recruiter_managers junction. */
export interface ManagerLink {
  is_primary?: boolean | null;
  assigned_at?: string | null;
  manager?: UserRef | null;
}

export interface Recruiter {
  id: string;
  user_id?: string | null;
  manager_id?: string | null;
  team?: string | null;
  status?: string | null;
  created_at: string;
  user?: UserRef | null;
  // Extended fields the API already returns but the mobile type historically
  // omitted — surfaced in the detail sheet to match the web Recruiters table.
  marketing_status?: MarketingStatus | null;
  target_submissions_per_week?: number | string | null;
  /** Server-computed count of the recruiter's active consultants. */
  consultant_count?: number | null;
  notes?: string | null;
  /** Legacy single primary manager (fallback when `managers` is empty). */
  manager?: UserRef | null;
  /** Many-to-many manager edges — the "Reports to" list. */
  managers?: ManagerLink[] | null;
}

/** A row from GET /managers (users with role MANAGER | HR_MANAGER). */
export interface Manager {
  id: string;
  email: string;
  full_name?: string | null;
  role?: Role;
  status?: string | null;
  group_id?: string | null;
  /** Server-computed count of recruiters reporting to this manager. */
  recruiter_count?: number | null;
  last_login_at?: string | null;
  created_at?: string | null;
  avatar_url?: string | null;
}

export interface Reminder {
  id: string;
  title: string;
  body?: string | null;
  remind_at: string;
  status?: string | null;
  created_by?: string | null;
  created_at: string;
}

export interface Resume {
  id: string;
  consultant_id?: string | null;
  file_name: string;
  storage_path?: string | null;
  version?: number | null;
  is_current?: boolean | null;
  download_url?: string | null;
  created_at: string;
}

export interface Vendor {
  id: string;
  company_name: string;
  contact_name?: string | null;
  contact_email?: string | null;
  phone?: string | null;
  notes?: string | null;
  created_at: string;
}

export interface Client {
  id: string;
  company_name: string;
  contact_name?: string | null;
  contact_email?: string | null;
  phone?: string | null;
  notes?: string | null;
  created_at: string;
}

export interface Invoice {
  id: string;
  invoice_number?: string | null;
  name?: string | null;
  description?: string | null;
  status?: string | null;
  bill_to?: string | null;
  amount_total?: number | null;
  amount_paid?: number | null;
  currency?: string | null;
  issue_date?: string | null;
  due_date?: string | null;
  created_at: string;
}

export interface TrainingCourse {
  id: string;
  title: string;
  description?: string | null;
  category?: string | null;
  is_published?: boolean | null;
  lesson_count?: number | null;
  created_at: string;
}

export interface TrainingLesson {
  id: string;
  course_id: string;
  title: string;
  body?: string | null;
  order_index?: number | null;
  duration_minutes?: number | null;
}

export interface TrainingAssignment {
  id: string;
  course_id: string;
  user_id: string;
  status?: string | null;
  progress_percent?: number | null;
  due_at?: string | null;
  completed_at?: string | null;
  course?: Partial<TrainingCourse> | null;
}

export interface UserGroup {
  id: string;
  name: string;
  slug: string;
  email?: string | null;
  color?: string | null;
  is_active?: boolean | null;
  member_count?: number | null;
  logo_url?: string | null;
  created_at: string;
}

export interface Invitation {
  id: string;
  email: string;
  role: Role;
  status?: string | null;
  expires_at?: string | null;
  created_at: string;
}

export interface AuditLogEntry {
  id: string;
  action: string;
  user_id?: string | null;
  email?: string | null;
  metadata?: Record<string, unknown> | null;
  ip_address?: string | null;
  created_at: string;
}

/** Standard paginated envelope used by the list endpoints. */
export interface Paginated<T> {
  data: T[];
  count?: number | null;
}
