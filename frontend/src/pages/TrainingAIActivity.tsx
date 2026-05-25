import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import clsx from 'clsx';
import { Layout } from '../components/Layout';
import { api } from '../services/api';
import { useRealtime } from '../hooks/useRealtime';

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

interface FocusedLesson {
  id: string;
  title: string;
  content_status: string | null;
  lesson_order: number;
  estimated_minutes: number | null;
  summary: string | null;
}

interface FocusedCourse {
  id: string;
  title: string;
  category: string;
  difficulty: string;
  content_status: string | null;
  lessons: FocusedLesson[];
}

const STATUS_LABEL: Record<string, string> = {
  GENERATING: 'Generating…',
  READY: 'Ready',
  FAILED: 'Failed',
  PENDING: 'Pending',
  OUTLINE_READY: 'Outline ready',
  DRAFT: 'Draft',
  NONE: 'Not started',
  UNKNOWN: 'Unknown',
};

const STATUS_COLOR: Record<string, string> = {
  GENERATING: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  READY: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
  FAILED: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  PENDING: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  OUTLINE_READY: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
  DRAFT: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
  NONE: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500',
};

function StatusPill({ status }: { status: string | null }) {
  const s = status ?? 'NONE';
  const cls = STATUS_COLOR[s] ?? STATUS_COLOR.NONE;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}
    >
      {s === 'GENERATING' && (
        <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse shrink-0" />
      )}
      {STATUS_LABEL[s] ?? s}
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
  if (diff < 5) return 'just now';
  if (diff < 60) return `${Math.round(diff)}s ago`;
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  return `${Math.round(diff / 86400)}d ago`;
}

function lessonStatusIcon(status: string | null) {
  switch (status) {
    case 'READY':
      return (
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400 text-xs font-bold shrink-0">
          ✓
        </span>
      );
    case 'GENERATING':
      return (
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/40 shrink-0">
          <span className="h-2.5 w-2.5 rounded-full bg-blue-500 animate-pulse" />
        </span>
      );
    case 'FAILED':
      return (
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/40 text-red-600 text-xs font-bold shrink-0">
          ✕
        </span>
      );
    default:
      return (
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800 shrink-0">
          <span className="h-1.5 w-1.5 rounded-full bg-zinc-400" />
        </span>
      );
  }
}

export function TrainingAIActivity() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const focusCourseId = params.get('course');

  const [data, setData] = useState<GenerationStatus | null>(null);
  const [focused, setFocused] = useState<FocusedCourse | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [error, setError] = useState('');
  const [retrying, setRetrying] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  type FeedKind = 'info' | 'ok' | 'err' | 'done';
  const [feed, setFeed] = useState<{ time: Date; text: string; kind: FeedKind }[]>([]);
  const pushFeed = useCallback((text: string, kind: FeedKind) => {
    setFeed((prev) => [{ time: new Date(), text, kind }, ...prev].slice(0, 60));
  }, []);

  useRealtime({
    'training:outline-start': (p: any) =>
      pushFeed(`Analysing course structure for "${p.courseTitle}"…`, 'info'),
    'training:outline-ready': (p: any) =>
      pushFeed(
        `Course outline ready — ${p.lessonCount} lesson${p.lessonCount === 1 ? '' : 's'} planned`,
        'ok',
      ),
    'training:lesson-start': (p: any) =>
      pushFeed(`Writing lesson ${p.index}/${p.total}: "${p.title}"…`, 'info'),
    'training:lesson-ready': (p: any) => pushFeed(`✓ Lesson ready: "${p.title}"`, 'ok'),
    'training:lesson-failed': (p: any) =>
      pushFeed(`✗ Failed: "${p.title}"${p.error ? ` — ${p.error}` : ''}`, 'err'),
    'training:course-ready': (_p: any) => pushFeed('Course generation complete.', 'done'),
    'training:course-failed': (p: any) =>
      pushFeed(`Course generation failed${p.error ? `: ${p.error}` : ''}`, 'err'),
  });

  const fetchStatus = useCallback(async () => {
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

  const fetchFocused = useCallback(async () => {
    if (!focusCourseId) return;
    try {
      const { data: d } = await api.get<any>(`/training/courses/${focusCourseId}`);
      setFocused({
        id: d.id,
        title: d.title,
        category: d.category,
        difficulty: d.difficulty,
        content_status: d.content_status ?? null,
        lessons: (d.lessons ?? [])
          .slice()
          .sort((a: any, b: any) => (a.lesson_order ?? 0) - (b.lesson_order ?? 0))
          .map((l: any) => ({
            id: l.id,
            title: l.title,
            content_status: l.content_status ?? null,
            lesson_order: l.lesson_order ?? 0,
            estimated_minutes: l.estimated_minutes ?? null,
            summary: l.summary ?? null,
          })),
      });
    } catch {
      // non-fatal — focused panel just won't show
    }
  }, [focusCourseId]);

  const refresh = useCallback(async () => {
    await Promise.all([fetchStatus(), fetchFocused()]);
  }, [fetchStatus, fetchFocused]);

  const retryGeneration = useCallback(
    async (courseId: string, force = false) => {
      setRetrying(true);
      try {
        const { data: r } = await api.post<{ queued: number; fixed: boolean }>(
          `/training/courses/${courseId}/retry`,
          { force },
        );
        if (r.fixed) {
          pushFeed('Course status corrected — all lessons were already complete.', 'ok');
        } else {
          pushFeed(
            `Queued ${r.queued} lesson${r.queued === 1 ? '' : 's'} for regeneration.`,
            'info',
          );
        }
        await refresh();
      } catch (e: any) {
        pushFeed(
          `Retry failed: ${e?.response?.data?.error ?? e?.message ?? 'unknown error'}`,
          'err',
        );
      } finally {
        setRetrying(false);
      }
    },
    [pushFeed, refresh],
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Poll faster when something is generating
  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    const hasActive =
      focused?.lessons.some(
        (l) => l.content_status === 'GENERATING' || l.content_status === 'PENDING',
      ) ||
      data?.active_lessons.some((l) => l.content_status === 'GENERATING') ||
      data?.active_courses.some((c) => c.content_status === 'GENERATING');
    intervalRef.current = setInterval(refresh, hasActive ? 5_000 : 30_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [refresh, data, focused]);

  const courses = data?.course_stats ?? {};
  const lessons = data?.lesson_stats ?? {};
  const totalCourses = Object.values(courses).reduce((s, v) => s + v, 0);
  const totalLessons = Object.values(lessons).reduce((s, v) => s + v, 0);
  const generating = (courses.GENERATING ?? 0) + (lessons.GENERATING ?? 0);
  const failed = (courses.FAILED ?? 0) + (lessons.FAILED ?? 0);

  const focusedReady = focused?.lessons.every(
    (l) => l.content_status === 'READY' || l.content_status === 'FAILED',
  );
  const focusedReadyCount =
    focused?.lessons.filter((l) => l.content_status === 'READY').length ?? 0;
  const focusedFailedCount =
    focused?.lessons.filter((l) => l.content_status === 'FAILED').length ?? 0;
  const focusedGeneratingCount =
    focused?.lessons.filter((l) => l.content_status === 'GENERATING').length ?? 0;
  const focusedPendingCount =
    focused?.lessons.filter((l) => l.content_status === 'PENDING').length ?? 0;
  const focusedTotal = focused?.lessons.length ?? 0;

  return (
    <Layout
      title="Training AI Activity"
      crumbs={[
        { label: 'Workspace', to: '/dashboard' },
        { label: 'Training', to: '/training/courses' },
        { label: 'AI Activity' },
      ]}
    >
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
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
              onClick={refresh}
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

        {/* ── FOCUSED COURSE PANEL ── */}
        {focused && (
          <div className="rounded-xl border-2 border-blue-200 dark:border-blue-800 bg-surface overflow-hidden">
            {/* Course header */}
            <div className="px-5 py-4 bg-blue-50 dark:bg-blue-950/30 border-b border-blue-200 dark:border-blue-800">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="text-xs font-semibold uppercase tracking-wider text-blue-600 dark:text-blue-400 mb-1">
                    {focusedGeneratingCount > 0
                      ? `Generating · ${focusedGeneratingCount} lesson${focusedGeneratingCount !== 1 ? 's' : ''} in progress`
                      : focusedPendingCount > 0
                        ? `Queued · ${focusedPendingCount} lesson${focusedPendingCount !== 1 ? 's' : ''} pending`
                        : focusedReady
                          ? 'Generation complete'
                          : 'Active'}
                  </div>
                  <div className="text-base font-semibold text-ink truncate">{focused.title}</div>
                  <div className="text-xs text-muted mt-0.5">
                    {focused.category} · {focused.difficulty}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                  {/* Fix status: course stuck as FAILED but all lessons done */}
                  {focused.content_status === 'FAILED' &&
                    focusedReadyCount === focusedTotal &&
                    focusedTotal > 0 && (
                      <button
                        onClick={() => retryGeneration(focused.id, false)}
                        disabled={retrying}
                        className="text-xs text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-700 rounded-lg px-2.5 py-1 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 disabled:opacity-50"
                      >
                        {retrying ? 'Fixing…' : 'Fix status'}
                      </button>
                    )}
                  {/* Retry: there are failed or pending lessons */}
                  {(focusedFailedCount > 0 || focusedPendingCount > 0) &&
                    focused.content_status !== 'GENERATING' && (
                      <button
                        onClick={() => retryGeneration(focused.id, false)}
                        disabled={retrying}
                        className="text-xs text-red-700 dark:text-red-400 border border-red-300 dark:border-red-700 rounded-lg px-2.5 py-1 hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-50"
                      >
                        {retrying
                          ? 'Queuing…'
                          : `Retry ${focusedFailedCount + focusedPendingCount} lesson${focusedFailedCount + focusedPendingCount === 1 ? '' : 's'}`}
                      </button>
                    )}
                  {/* Regenerate all: all lessons ready, allow re-run with improved prompts */}
                  {focusedReady && focused.content_status === 'READY' && focusedTotal > 0 && (
                    <button
                      onClick={() => retryGeneration(focused.id, true)}
                      disabled={retrying}
                      className="text-xs text-muted border border-border rounded-lg px-2.5 py-1 hover:bg-surface-hover disabled:opacity-50"
                    >
                      {retrying ? 'Queuing…' : '↺ Regenerate all'}
                    </button>
                  )}
                  <Link
                    to={`/training/courses/${focused.id}`}
                    className="text-xs text-accent hover:underline"
                  >
                    Open course →
                  </Link>
                </div>
              </div>

              {/* Progress bar */}
              {focusedTotal > 0 && (
                <div className="mt-3">
                  <div className="flex items-center justify-between text-xs text-muted mb-1">
                    <span>
                      {focusedReadyCount}/{focusedTotal} lessons ready
                      {focusedGeneratingCount > 0 && (
                        <span className="ml-2 text-blue-600 dark:text-blue-400">
                          · {focusedGeneratingCount} generating
                        </span>
                      )}
                      {focusedPendingCount > 0 && (
                        <span className="ml-2 text-amber-600 dark:text-amber-400">
                          · {focusedPendingCount} pending
                        </span>
                      )}
                      {focusedFailedCount > 0 && (
                        <span className="ml-2 text-red-600 dark:text-red-400">
                          · {focusedFailedCount} failed
                        </span>
                      )}
                    </span>
                    <span>{Math.round((focusedReadyCount / focusedTotal) * 100)}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-blue-200 dark:bg-blue-900 overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 rounded-full transition-all duration-1000"
                      style={{ width: `${Math.round((focusedReadyCount / focusedTotal) * 100)}%` }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Per-lesson list */}
            <div className="divide-y divide-border">
              {focused.lessons.map((lesson, idx) => (
                <div key={lesson.id} className="flex items-center gap-3 px-5 py-3">
                  {lessonStatusIcon(lesson.content_status)}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-ink truncate">
                      <span className="text-xs text-muted mr-2">{idx + 1}.</span>
                      {lesson.title}
                    </div>
                    {lesson.summary && lesson.content_status !== 'GENERATING' && (
                      <div className="text-xs text-muted truncate mt-0.5">{lesson.summary}</div>
                    )}
                    {lesson.content_status === 'GENERATING' && (
                      <div className="text-xs text-blue-600 dark:text-blue-400 mt-0.5 animate-pulse">
                        AI is writing this lesson…
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {lesson.estimated_minutes && (
                      <span className="text-xs text-muted hidden sm:inline">
                        {lesson.estimated_minutes}m
                      </span>
                    )}
                    <StatusPill status={lesson.content_status} />
                  </div>
                </div>
              ))}
            </div>

            {/* Footer — auto-navigate when done */}
            {focusedReady && focusedTotal > 0 && (
              <div className="px-5 py-3 bg-emerald-50 dark:bg-emerald-950/20 border-t border-emerald-200 dark:border-emerald-800 flex items-center justify-between gap-3">
                <span className="text-sm text-emerald-700 dark:text-emerald-400">
                  {focusedFailedCount === 0
                    ? `All ${focusedTotal} lessons generated successfully.`
                    : `${focusedReadyCount} ready, ${focusedFailedCount} failed — retry failed lessons from the course page.`}
                </span>
                <button
                  className="text-xs text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-700 rounded-lg px-3 py-1.5 hover:bg-emerald-100 dark:hover:bg-emerald-900/30"
                  onClick={() => navigate(`/training/courses/${focused.id}`)}
                >
                  Go to course →
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── LIVE ACTIVITY FEED ── */}
        {feed.length > 0 && (
          <div className="rounded-xl border border-border bg-surface p-4">
            <p className="text-[11px] font-mono uppercase tracking-wider text-muted mb-3">
              Live activity
            </p>
            <ul className="space-y-1.5 max-h-64 overflow-y-auto">
              {feed.map((item, i) => (
                <li key={i} className="flex items-start gap-2 text-xs">
                  <span className="font-mono text-[10px] text-muted shrink-0 mt-0.5">
                    {item.time.toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </span>
                  <span
                    className={clsx(
                      item.kind === 'ok' && 'text-success',
                      item.kind === 'err' && 'text-danger',
                      item.kind === 'done' && 'text-accent font-medium',
                      item.kind === 'info' && 'text-ink-2',
                    )}
                  >
                    {item.text}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ── SUMMARY STATS ── */}
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

        {/* Course breakdown */}
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

        {/* Lesson breakdown */}
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

        {/* Active / failed lessons across all courses */}
        {data && data.active_lessons.length > 0 && (
          <div className="rounded-xl border border-border bg-surface overflow-hidden">
            <div className="px-5 py-3 border-b border-border">
              <span className="text-sm font-medium text-ink">
                All in-progress / failed / pending lessons
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

        {/* Active courses */}
        {data && data.active_courses.length > 0 && (
          <div className="rounded-xl border border-border bg-surface overflow-hidden">
            <div className="px-5 py-3 border-b border-border">
              <span className="text-sm font-medium text-ink">Courses with active generation</span>
            </div>
            <div className="divide-y divide-border">
              {data.active_courses.map((c) => {
                const pct =
                  c.total_lessons > 0 ? Math.round((c.ready_lessons / c.total_lessons) * 100) : 0;
                const stuckDone =
                  c.content_status === 'FAILED' &&
                  c.ready_lessons === c.total_lessons &&
                  c.total_lessons > 0;
                const hasFailedLessons = c.failed_lessons > 0 || c.pending_lessons > 0;
                return (
                  <div
                    key={c.id}
                    className="px-5 py-3 hover:bg-surface-hover cursor-pointer"
                    onClick={() => navigate(`/training/ai-activity?course=${c.id}`)}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="min-w-0">
                        <span className="text-sm font-medium text-ink">{c.title}</span>
                        <span className="ml-2 text-xs text-muted">{c.category}</span>
                      </div>
                      <div className="flex items-center gap-2 ml-4 shrink-0">
                        <span className="text-xs text-muted">{relativeTime(c.updated_at)}</span>
                        <StatusPill status={c.content_status} />
                        {stuckDone && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              retryGeneration(c.id, false);
                            }}
                            disabled={retrying}
                            className="text-[11px] text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-600 rounded px-1.5 py-0.5 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 disabled:opacity-50"
                          >
                            Fix
                          </button>
                        )}
                        {!stuckDone && hasFailedLessons && c.content_status !== 'GENERATING' && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              retryGeneration(c.id, false);
                            }}
                            disabled={retrying}
                            className="text-[11px] text-red-700 dark:text-red-400 border border-red-300 dark:border-red-600 rounded px-1.5 py-0.5 hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-50"
                          >
                            Retry
                          </button>
                        )}
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
                          {c.ready_lessons}/{c.total_lessons} ready
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

        {data &&
          data.active_courses.length === 0 &&
          data.active_lessons.length === 0 &&
          !focused &&
          !loading && (
            <div className="rounded-xl border border-border bg-surface px-5 py-10 text-center">
              <div className="text-sm text-muted">
                All lessons are ready — no active generations.
              </div>
            </div>
          )}
      </div>
    </Layout>
  );
}
