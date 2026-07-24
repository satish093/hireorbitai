/**
 * /admin/calls-usage — org-wide monthly call-hour budget dashboard.
 *
 * Surfaces the same number the backend cap gate uses (CALLS_MONTHLY_HOUR_CAP,
 * default 980 hrs) so OWNER_TIER + DEVELOPER-with-cap can see how close
 * the workspace is to triggering the 503 service-paused state.
 *
 * Minimal by design — one card, one progress bar, one reset-date hint.
 * No per-user / per-call breakdown (raises privacy questions and isn't
 * what the user asked for). The 60s server-side cache means hitting
 * refresh just refreshes the SAME number until the cache expires;
 * showing "as of HH:MM" on the card prevents the operator from thinking
 * the page is stuck.
 */

import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { Layout } from '../components/Layout';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/Button';
import { SkeletonCard } from '../components/Skeleton';
import { api } from '../services/api';

interface UsageSnapshot {
  used_hours: number;
  cap_hours: number;
  cap_active: boolean;
  percent_used: number | null;
  cap_reached: boolean;
  reset_at_utc: string;
}

function formatHours(h: number): string {
  if (h < 1) return `${Math.round(h * 60)} min`;
  return `${h.toFixed(h >= 100 ? 0 : 1)} hr`;
}

function formatReset(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'UTC',
    });
  } catch {
    return iso;
  }
}

export default function AdminCallsUsage() {
  const [snap, setSnap] = useState<UsageSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get<UsageSnapshot>('/calls-usage');
      setSnap(data);
      setFetchedAt(new Date());
    } catch (e: any) {
      setError(e?.response?.data?.error ?? 'Failed to load call usage');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // Bar colour follows the same band convention axe-checks tolerate
  // against bg-surface: green under 75%, amber up to 95%, red beyond.
  // When the cap is disabled (cap_active=false) the bar collapses to
  // a flat amber row with "monitoring disabled" text instead.
  const pct = snap?.percent_used ?? 0;
  const barColor = !snap?.cap_active
    ? 'bg-amber-400'
    : pct < 75
      ? 'bg-emerald-500'
      : pct < 95
        ? 'bg-amber-500'
        : 'bg-rose-500';

  return (
    <Layout title="Call usage">
      <PageHeader
        title="Call usage"
        description="Org-wide monthly cap on accepted call duration. Resets at the start of every UTC calendar month."
        action={
          <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
            Refresh
          </Button>
        }
      />

      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded-lg px-4 py-3 text-sm mb-4">
          {error}
        </div>
      )}

      {loading && !snap ? (
        <SkeletonCard lines={4} />
      ) : snap ? (
        <div className="bg-surface border border-border rounded-xl p-6 max-w-2xl space-y-4">
          <div className="flex items-baseline justify-between gap-4">
            <div>
              <div className="text-xs uppercase tracking-widest text-muted">This month so far</div>
              <div className="text-3xl font-semibold text-ink mt-1">
                {formatHours(snap.used_hours)}
                {snap.cap_active && (
                  <span className="text-muted text-base font-normal">
                    {' '}
                    / {formatHours(snap.cap_hours)}
                  </span>
                )}
              </div>
            </div>
            {snap.cap_active && (
              <div className="text-right">
                <div className="text-xs uppercase tracking-widest text-muted">Used</div>
                <div
                  className={clsx(
                    'text-2xl font-semibold mt-1',
                    snap.cap_reached
                      ? 'text-rose-600'
                      : pct >= 95
                        ? 'text-rose-600'
                        : pct >= 75
                          ? 'text-amber-600'
                          : 'text-emerald-600',
                  )}
                >
                  {snap.percent_used?.toFixed(1)}%
                </div>
              </div>
            )}
          </div>

          {/* Progress bar */}
          <div className="h-3 bg-hover rounded-full overflow-hidden" aria-hidden>
            <div
              className={clsx('h-full transition-all duration-500', barColor)}
              style={{ width: snap.cap_active ? `${Math.min(100, pct)}%` : '100%' }}
            />
          </div>

          <div className="text-sm text-ink-2">
            {snap.cap_reached ? (
              <span className="text-rose-700 font-medium">
                Service paused — new calls return 503 until the next reset.
              </span>
            ) : !snap.cap_active ? (
              <span>Cap monitoring disabled (CALLS_MONTHLY_HOUR_CAP=0).</span>
            ) : (
              <span>
                {formatHours(snap.cap_hours - snap.used_hours)} remaining before new calls are
                refused.
              </span>
            )}
          </div>

          <div className="border-t border-border pt-3 text-xs text-muted flex items-center justify-between">
            <span>Resets {formatReset(snap.reset_at_utc)} UTC</span>
            {fetchedAt && <span>Updated {fetchedAt.toLocaleTimeString()}</span>}
          </div>
        </div>
      ) : null}

      <p className="text-xs text-muted mt-6 max-w-2xl">
        The cap exists to bound Cloudflare Realtime TURN egress at the free 1,000 GB/month tier. Set{' '}
        <code className="font-mono">CALLS_MONTHLY_HOUR_CAP</code> in{' '}
        <code className="font-mono">backend/.env</code> and reload PM2 to change the ceiling;{' '}
        <code className="font-mono">0</code> disables enforcement.
      </p>
    </Layout>
  );
}
