import clsx from 'clsx';
import { TaskPriority, TaskStatus, Task } from '../types';

// ---- Priority --------------------------------------------------------------

const PRIORITY_DOT: Record<TaskPriority, string> = {
  LOW: 'bg-blue-400',
  MEDIUM: 'bg-yellow-400',
  HIGH: 'bg-amber-500',
  CRITICAL: 'bg-red-500',
};

const PRIORITY_PILL: Record<TaskPriority, string> = {
  LOW: 'bg-blue-50 text-blue-700 border-blue-100',
  MEDIUM: 'bg-yellow-50 text-yellow-800 border-yellow-100',
  HIGH: 'bg-amber-50 text-amber-800 border-amber-100',
  CRITICAL: 'bg-red-50 text-red-700 border-red-100',
};

export function PriorityBadge({ priority }: { priority: TaskPriority }) {
  const label = priority.charAt(0) + priority.slice(1).toLowerCase();
  return (
    <span className={clsx(
      'inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-full border',
      PRIORITY_PILL[priority],
    )}>
      <span className={clsx('w-1.5 h-1.5 rounded-full', PRIORITY_DOT[priority])} />
      {label}
    </span>
  );
}

// ---- Status ----------------------------------------------------------------

const STATUS_PILL: Record<TaskStatus, string> = {
  BACKLOG: 'bg-slate-100 text-slate-700',
  TODO: 'bg-blue-50 text-blue-700',
  IN_PROGRESS: 'bg-amber-50 text-amber-800',
  BLOCKED: 'bg-red-50 text-red-700',
  REVIEW: 'bg-purple-50 text-purple-700',
  COMPLETED: 'bg-emerald-50 text-emerald-700',
  CANCELLED: 'bg-slate-100 text-slate-500',
};

const STATUS_DOT: Record<TaskStatus, string> = {
  BACKLOG: 'bg-slate-400',
  TODO: 'bg-blue-500',
  IN_PROGRESS: 'bg-amber-500',
  BLOCKED: 'bg-red-500',
  REVIEW: 'bg-purple-500',
  COMPLETED: 'bg-emerald-500',
  CANCELLED: 'bg-slate-300',
};

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const label = STATUS_LABELS[status];
  return (
    <span className={clsx(
      'inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-full',
      STATUS_PILL[status],
    )}>
      <span className={clsx('w-1.5 h-1.5 rounded-full', STATUS_DOT[status])} />
      {label}
    </span>
  );
}

const STATUS_LABELS: Record<TaskStatus, string> = {
  BACKLOG: 'Backlog',
  TODO: 'To Do',
  IN_PROGRESS: 'In Progress',
  BLOCKED: 'Blocked',
  REVIEW: 'Review',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

// ---- Due date --------------------------------------------------------------

export function isOverdue(task: Task): boolean {
  if (!task.due_at) return false;
  if (task.status === 'COMPLETED' || task.status === 'CANCELLED') return false;
  return new Date(task.due_at).getTime() < Date.now();
}

function dueRelative(due: Date): string {
  const now = new Date();
  const startToday = new Date(now); startToday.setHours(0, 0, 0, 0);
  const startDue = new Date(due); startDue.setHours(0, 0, 0, 0);
  const diffDays = Math.round((startDue.getTime() - startToday.getTime()) / (24 * 3600 * 1000));
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Due in 1d';
  if (diffDays > 1 && diffDays <= 7) return `Due in ${diffDays}d`;
  if (diffDays === -1) return 'Overdue · 1d';
  if (diffDays < -1) return `Overdue · ${Math.abs(diffDays)}d`;
  return due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function DuePill({ task }: { task: Task }) {
  if (!task.due_at) {
    return <span className="text-xs text-slate-400">No due date</span>;
  }
  const overdue = isOverdue(task);
  const due = new Date(task.due_at);
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full',
        overdue ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-700',
      )}
    >
      <span className={clsx('w-1.5 h-1.5 rounded-full', overdue ? 'bg-red-500' : 'bg-slate-400')} />
      {dueRelative(due)}
    </span>
  );
}

// Legacy export so existing imports keep working
export function DueDate({ task }: { task: Task }) { return <DuePill task={task} />; }

// ---- Avatar ----------------------------------------------------------------

const AVATAR_COLORS = [
  'bg-rose-100 text-rose-700',
  'bg-amber-100 text-amber-800',
  'bg-emerald-100 text-emerald-700',
  'bg-sky-100 text-sky-700',
  'bg-violet-100 text-violet-700',
  'bg-blue-100 text-blue-700',
  'bg-orange-100 text-orange-700',
  'bg-fuchsia-100 text-fuchsia-700',
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
  name, email, size = 24,
}: { name?: string | null; email?: string | null; size?: number }) {
  const seed = (email ?? name ?? '?');
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
    return <span className="text-xs text-slate-400 italic">Unassigned</span>;
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-slate-700">
      <Avatar name={task.assignee.full_name} email={task.assignee.email} size={20} />
      <span className="truncate max-w-[110px]">{task.assignee.full_name ?? task.assignee.email}</span>
    </span>
  );
}

// Legacy export — keep AssigneeLabel for older callers
export const AssigneeLabel = AssigneeChip;

// ---- Tag pill --------------------------------------------------------------

export function TagPill({ tag }: { tag: string }) {
  return (
    <span className="inline-flex items-center text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-mono">
      {tag}
    </span>
  );
}

// ---- Short id --------------------------------------------------------------

export function shortId(id: string): string {
  const tail = id.slice(-3);
  return `TB-${tail.toUpperCase()}`;
}
