// Shared types + status→column model for the Tasks workspace.
import type { Task, TaskStatus, TaskPriority } from '../../types';

export type ViewMode = 'kanban' | 'table' | 'timeline';

export interface FilterState {
  status?: TaskStatus | '';
  priority?: TaskPriority | '';
  assignee_id?: string;
  /** Filter by the assignee's group (company). '' / undefined = any group. */
  group_id?: string;
  consultant_id?: string;
  recruiter_id?: string;
  q?: string;
  overdue?: boolean;
  tag?: string;
}

/** Coerce the UI filter state (which uses '' for "any") into API criteria. */
export function toCriteria(f: FilterState): Record<string, string> {
  const out: Record<string, string> = {};
  if (f.status) out.status = f.status;
  if (f.priority) out.priority = f.priority;
  if (f.assignee_id) out.assignee_id = f.assignee_id;
  if (f.group_id) out.group_id = f.group_id;
  if (f.consultant_id) out.consultant_id = f.consultant_id;
  if (f.recruiter_id) out.recruiter_id = f.recruiter_id;
  if (f.q) out.q = f.q;
  if (f.overdue) out.overdue = 'true';
  if (f.tag) out.tag = f.tag;
  return out;
}

/** Client-side filtering for the workspace (the list is loaded in full). */
export function filterTasks(tasks: TaskRow[], f: FilterState): TaskRow[] {
  const q = f.q?.trim().toLowerCase();
  const tag = f.tag?.trim().toLowerCase();
  const now = Date.now();
  return tasks.filter((t) => {
    if (f.status && t.status !== f.status) return false;
    if (f.priority && t.priority !== f.priority) return false;
    if (f.assignee_id && t.assignee_id !== f.assignee_id) return false;
    if (f.group_id && (t.assignee?.group_id ?? '') !== f.group_id) return false;
    if (f.consultant_id && t.related_consultant_id !== f.consultant_id) return false;
    if (f.recruiter_id && t.related_recruiter_id !== f.recruiter_id) return false;
    if (tag && !(t.tags ?? []).some((x) => x.toLowerCase() === tag)) return false;
    if (f.overdue) {
      const due = t.due_at ? new Date(t.due_at).getTime() : NaN;
      const open = t.status !== 'COMPLETED' && t.status !== 'CANCELLED';
      if (!(open && Number.isFinite(due) && due < now)) return false;
    }
    if (q) {
      const hay = `${t.title} ${(t.tags ?? []).join(' ')} ${t.description ?? ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export type ColumnKey = 'todo' | 'in_progress' | 'in_review' | 'done';

export interface KanbanColumn {
  key: ColumnKey;
  label: string;
  /** Statuses bucketed into this column (so no task is hidden). */
  statuses: TaskStatus[];
  /** Status applied when a card is dropped into this column. */
  canonical: TaskStatus;
  dot: string;
}

// The status enum has 7 values; the board shows 4 columns, each owning a set so
// BACKLOG / BLOCKED / CANCELLED tasks stay visible. A drop sets the canonical.
export const KANBAN_COLUMNS: KanbanColumn[] = [
  {
    key: 'todo',
    label: 'To do',
    statuses: ['BACKLOG', 'TODO'],
    canonical: 'TODO',
    dot: 'bg-blue-500',
  },
  {
    key: 'in_progress',
    label: 'In progress',
    statuses: ['IN_PROGRESS', 'BLOCKED'],
    canonical: 'IN_PROGRESS',
    dot: 'bg-amber-500',
  },
  {
    key: 'in_review',
    label: 'In review',
    statuses: ['REVIEW'],
    canonical: 'REVIEW',
    dot: 'bg-purple-500',
  },
  {
    key: 'done',
    label: 'Done',
    statuses: ['COMPLETED', 'CANCELLED'],
    canonical: 'COMPLETED',
    dot: 'bg-emerald-500',
  },
];

const STATUS_TO_COLUMN: Record<TaskStatus, ColumnKey> = {
  BACKLOG: 'todo',
  TODO: 'todo',
  IN_PROGRESS: 'in_progress',
  BLOCKED: 'in_progress',
  REVIEW: 'in_review',
  COMPLETED: 'done',
  CANCELLED: 'done',
};
export const columnForStatus = (s: TaskStatus): ColumnKey => STATUS_TO_COLUMN[s] ?? 'todo';

/** Task augmented with the counts the new card/detail surfaces (optional —
 *  present only when the backend includes them). */
export type TaskRow = Task & {
  comment_count?: number;
  subtask_count?: number;
  subtask_done?: number;
};

export interface SavedView {
  id: string;
  name: string;
  filters: FilterState;
  sort_by?: string | null;
  view_mode: ViewMode;
  count?: number;
}

export interface Subtask {
  id: string;
  task_id: string;
  label: string;
  done: boolean;
  order_idx: number;
}

export type ActivityKind =
  | 'comment'
  | 'status_changed'
  | 'priority_changed'
  | 'assignee_changed'
  | 'created'
  | 'subtask_added'
  | 'subtask_completed';

export interface TaskActivity {
  id: string;
  task_id: string;
  actor_id?: string | null;
  kind: ActivityKind;
  payload?: Record<string, unknown> | null;
  created_at: string;
  actor?: { id?: string; full_name?: string | null; email?: string | null } | null;
}

export interface TaskUser {
  id: string;
  full_name?: string;
  email: string;
  role: string;
  group_id?: string | null;
}
