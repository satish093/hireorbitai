import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Button } from '../Button';
import { api } from '../../services/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RawTask {
  id: string;
  title?: string | null;
  status?: string | null;
  due_at?: string | null;
  due_date?: string | null;
  priority?: string | null;
  [key: string]: unknown;
}

interface FocusTask {
  id: string;
  title: string;
  status: string | null;
  dueMs: number; // parsed epoch
  priority: string;
  done: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DONE_STATUSES = new Set(['DONE', 'COMPLETED']);

function todayDateStr(): string {
  return new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
}

function parseDue(task: RawTask): number | null {
  const raw = task.due_at ?? task.due_date ?? null;
  if (!raw) return null;
  const ms = Date.parse(raw);
  return isNaN(ms) ? null : ms;
}

function formatTimeRemaining(ms: number): string {
  const diffMs = ms - Date.now();
  const diffMins = Math.round(diffMs / 60_000);
  if (diffMins <= 0) return 'due now';
  if (diffMins < 60) return `${diffMins}m left`;
  const hrs = Math.floor(diffMins / 60);
  const mins = diffMins % 60;
  if (mins === 0) return `${hrs}h left`;
  return `${hrs}h ${mins}m left`;
}

function normalizeTasks(raw: RawTask[]): FocusTask[] {
  const today = todayDateStr();
  return raw
    .filter((t) => {
      if (DONE_STATUSES.has(t.status ?? '')) return false;
      const ms = parseDue(t);
      if (ms === null) return false;
      // compare date portion only
      const dStr = new Date(ms).toISOString().slice(0, 10);
      return dStr === today;
    })
    .map((t) => ({
      id: t.id,
      title: t.title ?? '(Untitled)',
      status: t.status ?? null,
      dueMs: parseDue(t)!,
      priority: (t.priority as string | null) ?? 'TASK',
      done: false,
    }))
    .sort((a, b) => a.dueMs - b.dueMs)
    .slice(0, 6);
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function CheckIcon() {
  return (
    <svg
      width="11"
      height="9"
      viewBox="0 0 11 9"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polyline points="1 4.5 4 7.5 10 1.5" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="1" y="3" width="14" height="12" rx="2" />
      <line x1="1" y1="7" x2="15" y2="7" />
      <line x1="5" y1="1" x2="5" y2="5" />
      <line x1="11" y1="1" x2="11" y2="5" />
    </svg>
  );
}

function SkeletonRows() {
  return (
    <div className="flex flex-col gap-1">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-7 animate-pulse bg-bg-sunken rounded my-1" />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function TodaysFocus(): JSX.Element {
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<FocusTask[]>([]);
  const [loading, setLoading] = useState(true);
  // Track which tasks are mid-patch so we can revert on failure
  const [patching, setPatching] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .get<RawTask[]>('/tasks/assigned-to-me')
      .then((res) => {
        if (!cancelled) {
          setTasks(normalizeTasks(Array.isArray(res.data) ? res.data : []));
        }
      })
      .catch(() => {
        if (!cancelled) setTasks([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleCheck = useCallback(
    (taskId: string) => {
      if (patching.has(taskId)) return;

      // Optimistic update: mark done
      setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, done: true } : t)));
      setPatching((prev) => new Set(prev).add(taskId));

      api
        .patch(`/tasks/${taskId}`, { status: 'DONE' })
        .catch((err) => {
          // Revert
          setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, done: false } : t)));
          const msg = err?.response?.data?.message ?? err?.message ?? 'Could not mark task done.';
          toast.error(msg);
        })
        .finally(() => {
          setPatching((prev) => {
            const next = new Set(prev);
            next.delete(taskId);
            return next;
          });
        });
    },
    [patching],
  );

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-sm font-semibold text-ink mb-3">Today's focus</p>

      {loading ? (
        <SkeletonRows />
      ) : tasks.length === 0 ? (
        <div className="flex flex-col items-start gap-2 py-1">
          <p className="text-[13px] text-muted">Nothing due today.</p>
          <Button
            variant="outline"
            size="sm"
            leftIcon={<CalendarIcon />}
            onClick={() => navigate('/tasks')}
          >
            Plan your day
          </Button>
        </div>
      ) : (
        <ul className="flex flex-col">
          {tasks.map((task) => (
            <li key={task.id} className="flex items-center gap-3 py-2">
              {/* Checkbox button */}
              <Button
                variant="ghost"
                size="sm"
                iconOnly
                aria-label={task.done ? 'Mark undone' : 'Mark done'}
                disabled={patching.has(task.id)}
                onClick={() => handleCheck(task.id)}
                className="!p-0 !h-auto !w-auto !aspect-auto shrink-0"
              >
                <span
                  className={[
                    'flex items-center justify-center',
                    'w-[18px] h-[18px] rounded-[5px] border transition-colors duration-100',
                    task.done
                      ? 'bg-accent border-accent text-white'
                      : 'border-border-strong bg-surface text-transparent',
                  ].join(' ')}
                >
                  <CheckIcon />
                </span>
              </Button>

              {/* Title */}
              <span
                className={[
                  'flex-1 text-[13px] truncate',
                  task.done ? 'line-through text-muted' : 'text-ink',
                ].join(' ')}
              >
                {task.title}
              </span>

              {/* Meta: TAG · time remaining */}
              <span className="shrink-0 text-[11px] font-mono text-muted whitespace-nowrap">
                {task.priority.toUpperCase()} · {formatTimeRemaining(task.dueMs)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
