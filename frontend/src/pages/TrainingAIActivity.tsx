import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';

interface GenerationStatus {
  course_stats: Record<string, number>;
  lesson_stats: Record<string, number>;
  active_courses: ActiveCourse[];
  active_lessons: ActiveLesson[];
}

interface ActiveCourse {
  id: string;
  title: string;
  category: string;
  difficulty: string;
  content_status: string;
  updated_at: string;
  total_lessons: number;
  ready_lessons: number;
  generating_lessons: number;
  failed_lessons: number;
  pending_lessons: number;
}

interface ActiveLesson {
  id: string;
  title: string;
  content_status: string;
  updated_at: string;
  course_id: string;
  course_title: string;
}

const STATUS_LABEL: Record<string, string> = {
  GENERATING: 'Generating',
  READY: 'Ready',
  FAILED: 'Failed',
  PENDING: 'Pending',
  OUTLINE_READY: 'Outline ready',
  DRAFT: 'Draft',
  UNKNOWN: 'Unknown',
};

const STATUS_COLOR: Record<string, string> = {
  GENERATING: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  READY: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
  FAILED: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  PENDING: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  OUTLINE_READY: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
  DRAFT: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
};

function StatusPill({ status }: { status: string }) {
  const cls = STATUS_COLOR[status] ?? STATUS_COLOR.DRAFT;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}
    >
      {status === 'GENERATING' && (
        <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" />
      )}
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-xs text-muted mt-0.5">{label}</div>
    </div>
  );
}

function relativeTime(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return `${Math.round(diff)}s ago`;
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  return `${Math.round(diff / 86400)}d ago`;
}

export function TrainingAIActivity() {
  const navigate = useNavigate();
  const [data, setData] = useState<GenerationStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetch = useCallback(async () => {
    try {
      const { data: d } = await api.get<GenerationStatus>('/training/ai/generation-status');
      setData(d);
      setLastRefresh(new Date());
      setError('');
    } catch (e: any) {
      setError(e?.response?.data?.error ?? e?.message ?? 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch();
  }, [fetch]);

  // Auto-refresh every 8s when something is actively GENERATING, else every 30s
  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    const hasActive =
      data?.active_lessons.some((l) => l.content_status === 'GENERATING') ||
      data?.active_courses.some((c) => c.content_status === 'GENERATING');
    intervalRef.current = setInterval(fetch, hasActive ? 8_000 : 30_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetch, data]);

  const courses = data?.course_stats ?? {};
  const lessons = data?.lesson_stats ?? {};

  const totalCourses = Object.values(courses).reduce((s, v) => s + v, 0);
  const totalLessons = Object.values(lessons).reduce((s, v) => s + v, 0);
  const generating = (courses.GENERATING ?? 0) + (lessons.GENERATING ?? 0);
  const failed = (courses.FAILED ?? 0) + (lessons.FAILED ?? 0);

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink">Training AI Activity</h1>
          <p className="text-sm text-muted mt-0.5">
            Live status of AI content generation across all courses and lessons.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lastRefresh && (
            <span className="text-xs text-muted">
              Updated {relativeTime(lastRefresh.toISOString())}
            </span>
          )}
          <button
            onClick={fetch}
            className="text-xs text-accent hover:underline disabled:opacity-50"
            disabled={loading}
          >
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Total courses" value={totalCourses} color="text-ink" />
        <StatCard label="Total lessons" value={totalLessons} color="text-ink" />
        <StatCard
          label="Generating now"
          value={generating}
          color={generating > 0 ? 'text-blue-600 dark:text-blue-400' : 'text-ink'}
        />
        <StatCard
          label="Needs retry"
          value={failed}
          color={failed > 0 ? 'text-red-600 dark:text-red-400' : 'text-ink'}
        />
      </div>

      {/* Course status breakdown */}
      <div className="rounded-xl border border-border bg-surface p-5 space-y-3">
        <div className="text-sm font-medium text-ink">Course status breakdown</div>
        <div className="flex flex-wrap gap-2">
          {Object.entries(courses).length === 0 && !loading && (
            <span className="text-xs text-muted">No courses yet.</span>
          )}
          {Object.entries(courses)
            .sort((a, b) => b[1] - a[1])
            .map(([status, count]) => (
              <span
                key={status}
                className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs"
              >
                <StatusPill status={status} />
                <span className="font-semibold text-ink">{count}</span>
              </span>
            ))}
        </div>
      </div>

      {/* Lesson status breakdown */}
      <div className="rounded-xl border border-border bg-surface p-5 space-y-3">
        <div className="text-sm font-medium text-ink">Lesson status breakdown</div>
        <div className="flex flex-wrap gap-2">
          {Object.entries(lessons).length === 0 && !loading && (
            <span className="text-xs text-muted">No lessons yet.</span>
          )}
          {Object.entries(lessons)
            .sort((a, b) => b[1] - a[1])
            .map(([status, count]) => (
              <span
                key={status}
                className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs"
              >
                <StatusPill status={status} />
                <span className="font-semibold text-ink">{count}</span>
              </span>
            ))}
        </div>
      </div>

      {/* Active / failed lessons */}
      {data && data.active_lessons.length > 0 && (
        <div className="rounded-xl border border-border bg-surface overflow-hidden">
          <div className="px-5 py-3 border-b border-border">
            <span className="text-sm font-medium text-ink">
              Lessons in progress / failed / pending
            </span>
          </div>
          <div className="divide-y divide-border">
            {data.active_lessons.map((l) => (
              <div
                key={l.id}
                className="flex items-center justify-between px-5 py-3 hover:bg-surface-hover cursor-pointer"
                onClick={() => navigate(`/training/courses/${l.course_id}`)}
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium text-ink truncate">{l.title}</div>
                  <div className="text-xs text-muted truncate">{l.course_title}</div>
                </div>
                <div className="flex items-center gap-3 ml-4 shrink-0">
                  <span className="text-xs text-muted">{relativeTime(l.updated_at)}</span>
                  <StatusPill status={l.content_status} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Active / failed courses */}
      {data && data.active_courses.length > 0 && (
        <div className="rounded-xl border border-border bg-surface overflow-hidden">
          <div className="px-5 py-3 border-b border-border">
            <span className="text-sm font-medium text-ink">Courses with activity</span>
          </div>
          <div className="divide-y divide-border">
            {data.active_courses.map((c) => {
              const pct =
                c.total_lessons > 0 ? Math.round((c.ready_lessons / c.total_lessons) * 100) : 0;
              return (
                <div
                  key={c.id}
                  className="px-5 py-3 hover:bg-surface-hover cursor-pointer"
                  onClick={() => navigate(`/training/courses/${c.id}`)}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="min-w-0">
                      <span className="text-sm font-medium text-ink">{c.title}</span>
                      <span className="ml-2 text-xs text-muted">{c.category}</span>
                    </div>
                    <div className="flex items-center gap-2 ml-4 shrink-0">
                      <span className="text-xs text-muted">{relativeTime(c.updated_at)}</span>
                      <StatusPill status={c.content_status} />
                    </div>
                  </div>
                  {c.total_lessons > 0 && (
                    <div className="flex items-center gap-3">
                      <div className="flex-1 h-1.5 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-emerald-500 rounded-full transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-xs text-muted whitespace-nowrap">
                        {c.ready_lessons}/{c.total_lessons} lessons ready
                        {c.generating_lessons > 0 && ` · ${c.generating_lessons} generating`}
                        {c.failed_lessons > 0 && ` · ${c.failed_lessons} failed`}
                        {c.pending_lessons > 0 && ` · ${c.pending_lessons} pending`}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {data && data.active_courses.length === 0 && data.active_lessons.length === 0 && !loading && (
        <div className="rounded-xl border border-border bg-surface px-5 py-10 text-center">
          <div className="text-sm text-muted">All lessons are ready — no active generations.</div>
        </div>
      )}
    </div>
  );
}
