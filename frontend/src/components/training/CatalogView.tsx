import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { api } from '../../services/api';
import { invalidate } from '../../hooks/useInvalidate';
import { SkeletonCard } from '../Skeleton';
import { EmptyState } from '../EmptyState';
import { fmtMinutes, gradientFor, type CatalogCourse } from './types';

type Sort = 'title' | 'duration' | 'rating';

function CatalogCard({
  course,
  onEnroll,
  busy,
  navigate,
}: {
  course: CatalogCourse;
  onEnroll: (c: CatalogCourse) => void;
  busy: boolean;
  navigate: (to: string) => void;
}) {
  const hours = course.estimated_duration_hours;
  const badge = course.compliance_category
    ? { label: 'REQUIRED', cls: 'bg-warn-soft text-warn' }
    : course.enrolled >= 5
      ? { label: 'POPULAR', cls: 'bg-accent-soft text-accent' }
      : course.difficulty
        ? { label: course.difficulty, cls: 'bg-black/30 text-white' }
        : null;

  return (
    <div className="rounded-xl border border-border bg-surface overflow-hidden flex flex-col">
      {/* Deterministic gradient hero */}
      <div
        className="relative grid place-items-center text-white"
        style={{ height: 84, background: gradientFor(course.title) }}
      >
        <span className="text-3xl" aria-hidden="true">
          🎓
        </span>
        {badge && (
          <span
            className={clsx(
              'absolute top-2 right-2 text-[10px] font-mono uppercase rounded px-1.5 py-0.5',
              badge.cls,
            )}
          >
            {badge.label}
          </span>
        )}
      </div>

      <div className="p-3 flex flex-col flex-1 min-w-0">
        <button
          onClick={() => navigate(`/training/courses/${course.id}`)}
          className="text-sm font-semibold text-ink text-left leading-tight line-clamp-2 hover:underline"
        >
          {course.title}
        </button>
        <div className="text-[12px] text-muted mt-0.5">{course.category ?? 'General'}</div>

        {course.tags && course.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {course.tags.slice(0, 3).map((t) => (
              <span
                key={t}
                className="text-[10px] font-mono bg-bg-sunken text-ink-2 rounded px-1.5 py-0.5"
              >
                #{t}
              </span>
            ))}
          </div>
        )}

        <div className="flex items-center gap-3 mt-2 text-[11px] font-mono text-muted">
          {hours ? <span>{fmtMinutes(Math.round(hours * 60))}</span> : null}
          {course.rating > 0 && (
            <span title={`${course.rating_count} ratings`}>★ {course.rating.toFixed(1)}</span>
          )}
          <span>{course.enrolled} enrolled</span>
        </div>

        <div className="mt-3">
          {course.enrolled_by_me ? (
            <button
              onClick={() => navigate('/training')}
              className="w-full h-8 rounded-lg border border-border text-[13px] text-success"
            >
              ✓ Enrolled
            </button>
          ) : (
            <button
              onClick={() => onEnroll(course)}
              disabled={busy}
              className="w-full h-8 rounded-lg border border-border text-[13px] text-ink hover:bg-hover press disabled:opacity-50"
            >
              Enroll
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function CatalogView() {
  const navigate = useNavigate();
  const [courses, setCourses] = useState<CatalogCourse[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('all');
  const [sort, setSort] = useState<Sort>('title');
  const [enrolling, setEnrolling] = useState<string | null>(null);

  function load() {
    setLoading(true);
    api
      .get('/training/catalog')
      .then((r) => setCourses(r.data ?? []))
      .catch(() => setCourses([]))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  // Category list derived from real course data (no fabricated taxonomy).
  const categories = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of courses) {
      const k = c.category ?? 'General';
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [
      { key: 'all', label: 'All', count: courses.length },
      ...Array.from(m.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([key, count]) => ({ key, label: key, count })),
    ];
  }, [courses]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = courses.filter((c) => {
      if (cat !== 'all' && (c.category ?? 'General') !== cat) return false;
      if (!needle) return true;
      return (
        c.title.toLowerCase().includes(needle) ||
        (c.category ?? '').toLowerCase().includes(needle) ||
        (c.tags ?? []).some((t) => t.toLowerCase().includes(needle))
      );
    });
    return [...list].sort((a, b) => {
      if (sort === 'rating') return b.rating - a.rating;
      if (sort === 'duration')
        return (a.estimated_duration_hours ?? 0) - (b.estimated_duration_hours ?? 0);
      return a.title.localeCompare(b.title);
    });
  }, [courses, q, cat, sort]);

  async function enroll(c: CatalogCourse) {
    if (enrolling) return;
    setEnrolling(c.id);
    try {
      await api.post('/training/enroll', { course_id: c.id });
      toast.success(`Enrolled in ${c.title}`);
      setCourses((cs) =>
        cs.map((x) =>
          x.id === c.id ? { ...x, enrolled_by_me: true, enrolled: x.enrolled + 1 } : x,
        ),
      );
      invalidate('users');
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Could not enroll');
    } finally {
      setEnrolling(null);
    }
  }

  if (loading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonCard key={i} lines={3} />
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[200px_minmax(0,1fr)] items-start">
      {/* Category sidebar */}
      <aside className="space-y-0.5">
        {categories.map((c) => (
          <button
            key={c.key}
            onClick={() => setCat(c.key)}
            className={clsx(
              'flex items-center justify-between w-full px-2.5 py-1.5 rounded-lg text-[13px] text-left transition-colors',
              cat === c.key
                ? 'bg-accent-soft text-accent font-medium'
                : 'text-ink-2 hover:bg-hover',
            )}
          >
            <span className="truncate">{c.label}</span>
            <span className="text-[11px] font-mono text-muted">{c.count}</span>
          </button>
        ))}
      </aside>

      <div className="min-w-0">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search the catalog…"
            className="h-9 flex-1 min-w-[200px] rounded-lg border border-border bg-surface px-3 text-[13px] text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:border-accent"
          />
          <button
            onClick={() => setSort('duration')}
            className={clsx(
              'h-9 px-3 rounded-lg border text-[13px] press',
              sort === 'duration'
                ? 'bg-accent-soft border-accent/40 text-accent'
                : 'bg-surface border-border text-ink-2',
            )}
          >
            Duration
          </button>
          <button
            onClick={() => setSort('rating')}
            className={clsx(
              'h-9 px-3 rounded-lg border text-[13px] press',
              sort === 'rating'
                ? 'bg-accent-soft border-accent/40 text-accent'
                : 'bg-surface border-border text-ink-2',
            )}
          >
            Rating
          </button>
          <span className="text-[12px] font-mono text-muted ml-auto">{visible.length} courses</span>
        </div>

        {visible.length === 0 ? (
          <EmptyState
            compact
            icon="🔍"
            title="No courses match"
            description="Try a different search or category."
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {visible.map((c) => (
              <CatalogCard
                key={c.id}
                course={c}
                onEnroll={enroll}
                busy={enrolling === c.id}
                navigate={navigate}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
