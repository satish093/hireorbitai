export type Role =
  | 'SUPER_ADMIN' | 'CEO' | 'CTO' | 'DIRECTOR'
  | 'MANAGER' | 'HR_MANAGER' | 'DEVELOPER'
  | 'RECRUITER' | 'CONSULTANT';

export const OWNER_TIER: Role[] = ['SUPER_ADMIN', 'CEO'];
export const ADMIN_TIER: Role[] = ['SUPER_ADMIN', 'CEO', 'CTO', 'DIRECTOR'];
export const MANAGER_TIER: Role[] = [...ADMIN_TIER, 'MANAGER', 'HR_MANAGER', 'DEVELOPER'];
export const OPERATOR_TIER: Role[] = [...MANAGER_TIER, 'RECRUITER'];
export const ALL_ROLES: Role[] = [...OPERATOR_TIER, 'CONSULTANT'];

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
}

export type MarketingStatus = 'ACTIVE' | 'PAUSED' | 'PLACED';
export type ApplicationStatus =
  | 'SUBMITTED' | 'SCREENING' | 'INTERVIEW' | 'OFFER' | 'REJECTED' | 'WITHDRAWN';
export type InterviewType = 'PHONE' | 'TECHNICAL' | 'BEHAVIORAL' | 'ONSITE' | 'FINAL' | 'MOCK';
export type InterviewStatus = 'SCHEDULED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';

export type TaskStatus =
  | 'BACKLOG' | 'TODO' | 'IN_PROGRESS' | 'BLOCKED' | 'REVIEW' | 'COMPLETED' | 'CANCELLED';
export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export const TASK_STATUSES: TaskStatus[] = [
  'BACKLOG', 'TODO', 'IN_PROGRESS', 'BLOCKED', 'REVIEW', 'COMPLETED', 'CANCELLED',
];
export const TASK_PRIORITIES: TaskPriority[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  BACKLOG: 'Backlog',
  TODO: 'To Do',
  IN_PROGRESS: 'In Progress',
  BLOCKED: 'Blocked',
  REVIEW: 'Review',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

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
  assignee?: { id: string; email: string; full_name?: string | null; role?: Role } | null;
  creator?: { id: string; email: string; full_name?: string | null; role?: Role } | null;
  consultant?: { id: string; user?: { full_name?: string | null; email: string } } | null;
  recruiter?: { id: string; user?: { full_name?: string | null; email: string } } | null;
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
