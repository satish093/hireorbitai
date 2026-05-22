// Shared types + helpers for the /training learning workspace.

export type TrainingTab = 'mine' | 'plan' | 'catalog' | 'achievements';

export const TRAINING_TABS: { key: TrainingTab; label: string; sparkle?: boolean }[] = [
  { key: 'mine', label: 'My training' },
  { key: 'plan', label: 'Study plan', sparkle: true },
  { key: 'catalog', label: 'Catalog' },
  { key: 'achievements', label: 'Achievements' },
];

export interface MyAssignment {
  id: string;
  course_id: string;
  status: string;
  progress_percentage: number;
  due_date: string | null;
  training_start_date?: string | null;
  training_end_date?: string | null;
  course?: { title?: string; category?: string; compliance_category?: string | null } | null;
}

export interface ContinueLesson {
  assignment_id: string;
  course_id: string;
  course_title: string;
  lesson_title: string | null;
  percent: number;
  remaining_min: number | null;
}

export interface ComplianceItem {
  assignment_id: string;
  title: string;
  category: string;
  status: string;
  due_date: string | null;
  percent: number;
  tone: 'success' | 'danger' | 'warn' | 'muted';
}

export interface ActivityResp {
  series: { date: string; minutes: number }[];
  streak: number;
  best: number;
}

export interface Achievement {
  key: string;
  title: string;
  description: string;
  tone: 'accent' | 'success' | 'warn' | 'danger';
  earned_at: string | null;
}

export interface PlanItem {
  id: string;
  week_no: number;
  week_label: string | null;
  focus_area: string | null;
  title: string;
  item_type: string;
  duration_min: number | null;
  course_id: string | null;
  completed: boolean;
}

export interface StudyPlan {
  id: string;
  title: string;
  rationale: string | null;
  created_at: string;
  items: PlanItem[];
}

export interface CatalogCourse {
  id: string;
  title: string;
  category: string | null;
  tags: string[] | null;
  estimated_duration_hours: number | null;
  compliance_category: string | null;
  difficulty: string | null;
  rating: number;
  rating_count: number;
  enrolled: number;
  enrolled_by_me: boolean;
}

// ── Status → group ──────────────────────────────────────────────────────────
export type GroupKey = 'in_progress' | 'up_next' | 'completed';

export function groupForStatus(status: string): GroupKey {
  if (status === 'COMPLETED') return 'completed';
  if (status === 'NOT_STARTED') return 'up_next';
  return 'in_progress'; // IN_PROGRESS + all the *_PENDING / OVERDUE / FAILED states
}

export const GROUP_LABEL: Record<GroupKey, string> = {
  in_progress: 'In progress',
  up_next: 'Up next',
  completed: 'Completed',
};

// ── Tone tokens for compliance/achievement dots (no literal colors) ─────────
export const DOT_TONE: Record<'success' | 'danger' | 'warn' | 'muted' | 'accent', string> = {
  success: 'bg-success',
  danger: 'bg-danger',
  warn: 'bg-warn',
  muted: 'bg-[color:var(--muted)]',
  accent: 'bg-accent',
};

export const SOFT_TONE: Record<
  'accent' | 'success' | 'warn' | 'danger',
  { bg: string; text: string }
> = {
  accent: { bg: 'bg-accent-soft', text: 'text-accent' },
  success: { bg: 'bg-success-soft', text: 'text-success' },
  warn: { bg: 'bg-warn-soft', text: 'text-warn' },
  danger: { bg: 'bg-danger-soft', text: 'text-danger' },
};

// ── Helpers ─────────────────────────────────────────────────────────────────
export function fmtMinutes(min: number | null | undefined): string {
  if (!min || min <= 0) return '—';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function relativeDay(iso: string | null | undefined): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  const d = Math.round(ms / 86_400_000);
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 14) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

/** Due-date urgency → label + tone, or null when no/whenever due. */
export function dueUrgency(
  due: string | null | undefined,
): { label: string; tone: 'danger' | 'warn' } | null {
  if (!due) return null;
  const ms = new Date(due).getTime() - Date.now();
  const days = Math.ceil(ms / 86_400_000);
  if (days < 0) return { label: 'Overdue', tone: 'danger' };
  if (days === 0) return { label: 'Due today', tone: 'danger' };
  if (days <= 7)
    return {
      label: `Due ${new Date(due).toLocaleDateString(undefined, { weekday: 'long' })}`,
      tone: 'warn',
    };
  return null;
}

/**
 * Deterministic gradient for a catalog hero from the course name — the same
 * course always gets the same tint. Returns an inline `background` value using
 * two hues derived from a stable string hash.
 */
export function gradientFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  const hue2 = (hue + 40) % 360;
  return `linear-gradient(135deg, oklch(0.62 0.16 ${hue}), oklch(0.55 0.2 ${hue2}))`;
}

export const PLAN_ITEM_ICON: Record<string, string> = {
  Course: '📚',
  Lesson: '▶',
  Quiz: '✓',
  Read: '📖',
  Live: '●',
};
