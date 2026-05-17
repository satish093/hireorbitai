import clsx from 'clsx';
import { TaskPriority, TaskStatus, Task } from '../types';
import { GroupBadge } from './GroupBadge';
import { Pill, PillTone, TagPillBase } from './Pill';

// All badges in this file share the Pill primitive — same height, radius,
// padding, font size, and gap. Only the tone tokens change per variant.

// ---- Priority --------------------------------------------------------------

const PRIORITY_TONE: Record<TaskPriority, PillTone> = {
  LOW: { bg: 'bg-blue-50', text: 'text-blue-700', dot: 'bg-blue-400', border: 'border-blue-100' },
  MEDIUM: {
    bg: 'bg-yellow-50',
    text: 'text-yellow-800',
    dot: 'bg-yellow-400',
    border: 'border-yellow-100',
  },
  HIGH: {
    bg: 'bg-amber-50',
    text: 'text-amber-800',
    dot: 'bg-amber-500',
    border: 'border-amber-100',
  },
  CRITICAL: {
    bg: 'bg-red-50',
    text: 'text-red-700',
    dot: 'bg-red-500',
    border: 'border-red-100',
  },
};

export function PriorityBadge({ priority }: { priority: TaskPriority }) {
  const label = priority.charAt(0) + priority.slice(1).toLowerCase();
  return <Pill tone={PRIORITY_TONE[priority]}>{label}</Pill>;
}

// ---- Status ----------------------------------------------------------------

const STATUS_TONE: Record<TaskStatus, PillTone> = {
  BACKLOG: { bg: 'bg-slate-100', text: 'text-slate-700', dot: 'bg-slate-400' },
  TODO: { bg: 'bg-blue-50', text: 'text-blue-700', dot: 'bg-blue-500' },
  IN_PROGRESS: { bg: 'bg-amber-50', text: 'text-amber-800', dot: 'bg-amber-500' },
  BLOCKED: { bg: 'bg-red-50', text: 'text-red-700', dot: 'bg-red-500' },
  REVIEW: { bg: 'bg-purple-50', text: 'text-purple-700', dot: 'bg-purple-500' },
  COMPLETED: { bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  CANCELLED: { bg: 'bg-slate-100', text: 'text-slate-500', dot: 'bg-slate-300' },
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

const DUE_OVERDUE: PillTone = { bg: 'bg-red-50', text: 'text-red-700', dot: 'bg-red-500' };
const DUE_NORMAL: PillTone = { bg: 'bg-slate-100', text: 'text-slate-700', dot: 'bg-slate-400' };

export function DuePill({ task }: { task: Task }) {
  if (!task.due_at) {
    return <span className="text-xs text-slate-400">No due date</span>;
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
    return <span className="text-xs text-slate-400 italic">Unassigned</span>;
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-slate-700">
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
