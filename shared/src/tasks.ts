/**
 * Task status / priority enums — shared between backend (request validation,
 * DB checks) and frontend (filter UI, badge styling).
 */

export type TaskStatus =
  | 'BACKLOG'
  | 'TODO'
  | 'IN_PROGRESS'
  | 'BLOCKED'
  | 'REVIEW'
  | 'COMPLETED'
  | 'CANCELLED';

export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export const TASK_STATUSES: TaskStatus[] = [
  'BACKLOG',
  'TODO',
  'IN_PROGRESS',
  'BLOCKED',
  'REVIEW',
  'COMPLETED',
  'CANCELLED',
];

export const TASK_PRIORITIES: TaskPriority[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

// TASK_STATUS_LABEL stays in `frontend/src/types/index.ts` — display
// capitalisation is a UI concern, not a domain-model concern.
