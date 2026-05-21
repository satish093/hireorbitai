import clsx from 'clsx';
import { TaskPriority, TaskStatus, Task } from '../types';
import { GroupBadge } from './GroupBadge';
import { Pill, PillTone, TagPillBase } from './Pill';

// All badges in this file share the Pill primitive — same height, radius,
// padding, font size, and gap. Only the tone tokens change per variant.

// ---- Priority --------------------------------------------------------------

const PRIORITY_TONE: Record<TaskPriority, PillTone> = {
  LOW: {
    bg: 'bg-blue-50 dark:bg-blue-500/15',
    text: 'text-blue-700 dark:text-blue-300',
    dot: 'bg-blue-400',
    border: 'border-blue-100 dark:border-blue-500/20',
  },
  MEDIUM: {
    bg: 'bg-yellow-50 dark:bg-yellow-500/15',
    text: 'text-yellow-800 dark:text-yellow-300',
    dot: 'bg-yellow-400',
    border: 'border-yellow-100 dark:border-yellow-500/20',
  },
  HIGH: {
    bg: 'bg-amber-50 dark:bg-amber-500/15',
    text: 'text-amber-800 dark:text-amber-300',
    dot: 'bg-amber-500',
    border: 'border-amber-100 dark:border-amber-500/20',
  },
  CRITICAL: {
    bg: 'bg-red-50 dark:bg-red-500/15',
    text: 'text-red-700 dark:text-red-300',
    dot: 'bg-red-500',
    border: 'border-red-100 dark:border-red-500/20',
  },
};

export function PriorityBadge({ priority }: { priority: TaskPriority }) {
  const label = priority.charAt(0) + priority.slice(1).toLowerCase();
  return <Pill tone={PRIORITY_TONE[priority]}>{label}</Pill>;
}

// ---- Status ----------------------------------------------------------------

const STATUS_TONE: Record<TaskStatus, PillTone> = {
  BACKLOG: { bg: 'bg-muted', text: 'text-foreground', dot: 'bg-muted-foreground' },
  TODO: {
    bg: 'bg-blue-50 dark:bg-blue-500/15',
    text: 'text-blue-700 dark:text-blue-300',
    dot: 'bg-blue-500',
  },
  IN_PROGRESS: {
    bg: 'bg-amber-50 dark:bg-amber-500/15',
    text: 'text-amber-800 dark:text-amber-300',
    dot: 'bg-amber-500',
  },
  BLOCKED: {
    bg: 'bg-red-50 dark:bg-red-500/15',
    text: 'text-red-700 dark:text-red-300',
    dot: 'bg-red-500',
  },
  REVIEW: {
    bg: 'bg-purple-50 dark:bg-purple-500/15',
    text: 'text-purple-700 dark:text-purple-300',
    dot: 'bg-purple-500',
  },
  COMPLETED: {
    bg: 'bg-emerald-50 dark:bg-emerald-500/15',
    text: 'text-emerald-700 dark:text-emerald-300',
    dot: 'bg-emerald-500',
  },
  CANCELLED: { bg: 'bg-muted', text: 'text-muted-foreground', dot: 'bg-muted-foreground' },
};

const STATUS_LABELS: Record<TaskStatus, string> = {
  BACKLOG: 'Backlog',
  TODO: 'To Do',
  IN_PROGRESS: 'In Progress',
  BLOCKED: 'Blocked',
  REVIEW: 'Review',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  return <Pill tone={STATUS_TONE[status]}>{STATUS_LABELS[status]}</Pill>;
}

// ---- Due date --------------------------------------------------------------

export function isOverdue(task: Task): boolean {
  if (!task.due_at) return false;
  if (task.status === 'COMPLETED' || task.status === 'CANCELLED') return false;
  return new Date(task.due_at).getTime() < Date.now();
}

function dueRelative(due: Date): string {
  const now = new Date();
  const startToday = new Date(now);
  startToday.setHours(0, 0, 0, 0);
  const startDue = new Date(due);
  startDue.setHours(0, 0, 0, 0);
  const diffDays = Math.round((startDue.getTime() - startToday.getTime()) / (24 * 3600 * 1000));
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Due in 1d';
  if (diffDays > 1 && diffDays <= 7) return `Due in ${diffDays}d`;
  if (diffDays === -1) return 'Overdue · 1d';
  if (diffDays < -1) return `Overdue · ${Math.abs(diffDays)}d`;
  return due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const DUE_OVERDUE: PillTone = {
  bg: 'bg-red-50 dark:bg-red-500/15',
  text: 'text-red-700 dark:text-red-300',
  dot: 'bg-red-500',
};
const DUE_NORMAL: PillTone = {
  bg: 'bg-muted',
  text: 'text-foreground',
  dot: 'bg-muted-foreground',
};

export function DuePill({ task }: { task: Task }) {
  if (!task.due_at) {
    return <span className="text-xs text-muted-foreground">No due date</span>;
  }
  const overdue = isOverdue(task);
  const due = new Date(task.due_at);
  return <Pill tone={overdue ? DUE_OVERDUE : DUE_NORMAL}>{dueRelative(due)}</Pill>;
}

// Legacy export so existing imports keep working
export function DueDate({ task }: { task: Task }) {
  return <DuePill task={task} />;
}

// ---- Avatar ----------------------------------------------------------------

const AVATAR_COLORS = [
  'bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-300',
  'bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300',
  'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300',
  'bg-sky-100 dark:bg-sky-500/20 text-sky-700 dark:text-sky-300',
  'bg-violet-100 dark:bg-violet-500/20 text-violet-700 dark:text-violet-300',
  'bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300',
  'bg-orange-100 dark:bg-orange-500/20 text-orange-700 dark:text-orange-300',
  'bg-fuchsia-100 dark:bg-fuchsia-500/20 text-fuchsia-700 dark:text-fuchsia-300',
];

function hashColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length]!;
}

export function initialsOf(name?: string | null, email?: string | null): string {
  const src = (name && name.trim()) || (email && email.split('@')[0]) || '';
  const parts = src.split(/\s+|\.|_|-/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

export function Avatar({
  name,
  email,
  size = 24,
}: {
  name?: string | null;
  email?: string | null;
  size?: number;
}) {
  const seed = email ?? name ?? '?';
  return (
    <span
      className={clsx(
        'inline-flex items-center justify-center rounded-full font-semibold',
        hashColor(seed),
      )}
      style={{ width: size, height: size, fontSize: Math.max(10, Math.floor(size / 2.4)) }}
      title={name ?? email ?? ''}
    >
      {initialsOf(name, email)}
    </span>
  );
}

export function AssigneeChip({ task }: { task: Task }) {
  if (!task.assignee) {
    return <span className="text-xs text-muted-foreground italic">Unassigned</span>;
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-foreground">
      <GroupBadge groupId={task.assignee.group_id ?? null} compact hideEmpty />
      <Avatar name={task.assignee.full_name} email={task.assignee.email} size={20} />
      <span className="truncate max-w-[110px]">
        {task.assignee.full_name ?? task.assignee.email}
      </span>
    </span>
  );
}

// Legacy export — keep AssigneeLabel for older callers
export const AssigneeLabel = AssigneeChip;

// ---- Tag pill --------------------------------------------------------------

export function TagPill({ tag }: { tag: string }) {
  return <TagPillBase>{tag}</TagPillBase>;
}

// ---- Short id --------------------------------------------------------------

export function shortId(id: string): string {
  const tail = id.slice(-3);
  return `HO-${tail.toUpperCase()}`;
}
