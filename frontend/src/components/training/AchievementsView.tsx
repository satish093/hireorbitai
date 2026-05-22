import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { api } from '../../services/api';
import { SkeletonCard } from '../Skeleton';
import { EmptyState } from '../EmptyState';
import { SOFT_TONE, type Achievement } from './types';

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex-1 min-w-[120px] bg-surface border border-border rounded-xl px-4 py-3">
      <div className="text-2xl font-semibold text-ink tabular-nums">{value}</div>
      <div className="text-[11px] font-medium uppercase tracking-wider text-muted mt-0.5">
        {label}
      </div>
    </div>
  );
}

function MedalCard({ a }: { a: Achievement }) {
  const earned = !!a.earned_at;
  const tone = SOFT_TONE[a.tone] ?? SOFT_TONE.accent;
  return (
    <div
      className={clsx(
        'rounded-xl border bg-surface p-4 flex flex-col items-center text-center',
        earned ? 'border-border' : 'border-dashed border-border opacity-50',
      )}
    >
      <span
        className={clsx(
          'grid place-items-center rounded-full text-xl mb-2',
          earned ? `${tone.bg} ${tone.text}` : 'bg-bg-sunken text-muted',
        )}
        style={{ width: 48, height: 48 }}
        aria-hidden="true"
      >
        {earned ? '★' : '🛡'}
      </span>
      <div className="text-sm font-semibold text-ink">{a.title}</div>
      <p className="text-[12px] text-muted mt-0.5 line-clamp-2">{a.description}</p>
      <div className="text-[10px] font-mono text-faint mt-2">
        {earned ? `Earned ${new Date(a.earned_at!).toLocaleDateString()}` : 'Locked'}
      </div>
    </div>
  );
}

export function AchievementsView() {
  const [items, setItems] = useState<Achievement[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .get('/training/achievements')
      .then((r) => alive && setItems(r.data ?? []))
      .catch(() => alive && setItems([]))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonCard key={i} lines={3} />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        icon="🏅"
        title="No achievements yet"
        description="Complete lessons and pass quizzes to start earning badges."
      />
    );
  }

  const earned = items.filter((a) => a.earned_at).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-3">
        <Metric label="Earned" value={earned} />
        <Metric label="In progress" value={items.length - earned} />
        <Metric label="Total available" value={items.length} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {items.map((a) => (
          <MedalCard key={a.key} a={a} />
        ))}
      </div>
    </div>
  );
}
