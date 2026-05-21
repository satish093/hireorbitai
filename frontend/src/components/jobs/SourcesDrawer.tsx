import { useEffect, useState } from 'react';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import { api } from '../../services/api';
import { Button } from '../Button';
import { SkeletonCard } from '../Skeleton';
import { SourceBadge } from './sourceTokens';
import type { SourceCompany, SourceHealth } from './types';

export function SourcesDrawer({
  onClose,
  onAfterSync,
}: {
  onClose: () => void;
  onAfterSync: () => void;
}) {
  const [rows, setRows] = useState<SourceCompany[]>([]);
  const [health, setHealth] = useState<SourceHealth[]>([]);
  const [loading, setLoading] = useState(true);
  const [newSource, setNewSource] = useState<
    | 'greenhouse'
    | 'lever'
    | 'remoteok'
    | 'adzuna'
    | 'remotive'
    | 'arbeitnow'
    | 'jsearch'
    | 'ashby'
    | 'jooble'
    | 'usajobs'
    | 'serpapi'
    | 'searchapi'
    | 'linkedin'
    | 'monster'
  >('greenhouse');
  const [newSlug, setNewSlug] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [r, h] = await Promise.all([
        api.get('/jobs/sources'),
        api.get('/jobs/sources/health').catch(() => ({ data: [] })),
      ]);
      setRows(r.data ?? []);
      setHealth(h.data ?? []);
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to load sources');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function add() {
    if ((newSource === 'greenhouse' || newSource === 'lever') && !newSlug.trim()) {
      toast.error(`${newSource} needs a company slug (e.g. "stripe")`);
      return;
    }
    try {
      await api.post('/jobs/sources', {
        source: newSource,
        slug: newSource === 'remoteok' || newSource === 'adzuna' ? null : newSlug.trim(),
        display_name: newSlug.trim() || newSource,
      });
      setNewSlug('');
      toast.success('Source added');
      load();
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to add');
    }
  }

  async function syncOne(id: string) {
    setBusy(id);
    try {
      const r = await api.post(`/jobs/sources/${id}/sync`);
      const rep = r.data;
      if (rep.error) toast.error(`Sync error: ${rep.error}`);
      else toast.success(`Pulled ${rep.jobs_pulled} jobs`);
      onAfterSync();
      load();
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Sync failed');
    } finally {
      setBusy(null);
    }
  }

  async function toggle(c: SourceCompany) {
    try {
      await api.patch(`/jobs/sources/${c.id}`, { is_active: !c.is_active });
      load();
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Something went wrong. Please try again.');
    }
  }

  async function remove(c: SourceCompany) {
    if (!confirm(`Remove ${c.display_name ?? c.slug ?? c.source}?`)) return;
    try {
      await api.delete(`/jobs/sources/${c.id}`);
      toast.success('Removed');
      load();
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Something went wrong. Please try again.');
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/30 flex justify-end" onClick={onClose}>
      <div
        className="bg-surface w-full max-w-md h-full overflow-y-auto shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-ink">Live job sources</h2>
            <p className="text-xs text-muted">
              Pull real-time listings from legitimate public APIs.
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            leftIcon={<span className="text-xl leading-none">×</span>}
            onClick={onClose}
          />
        </div>

        {/* Add new source */}
        <div className="p-5 border-b border-border bg-hover">
          <h3 className="text-sm font-semibold text-ink mb-2">Add a company / feed</h3>
          <div className="grid grid-cols-3 gap-2">
            <select
              value={newSource}
              onChange={(e) => setNewSource(e.target.value as any)}
              className="border border-border rounded-lg px-2 py-1.5 text-sm bg-surface"
            >
              <option value="greenhouse">Greenhouse</option>
              <option value="lever">Lever</option>
              <option value="ashby">Ashby</option>
              <option value="remoteok">RemoteOK</option>
              <option value="remotive">Remotive</option>
              <option value="arbeitnow">Arbeitnow</option>
              <option value="adzuna">Adzuna</option>
              <option value="jsearch">JSearch (Indeed / LinkedIn)</option>
              <option value="jooble">Jooble</option>
              <option value="usajobs">USAJobs</option>
              <option value="serpapi">SerpAPI Google Jobs</option>
              <option value="searchapi">SearchApi.io Google Jobs</option>
              <option value="linkedin">LinkedIn (Fantastic Jobs)</option>
              <option value="monster">Monster (RapidAPI)</option>
            </select>
            <input
              value={newSlug}
              onChange={(e) => setNewSlug(e.target.value)}
              placeholder={
                newSource === 'greenhouse' || newSource === 'lever' || newSource === 'ashby'
                  ? 'e.g. stripe'
                  : newSource === 'linkedin'
                    ? 'e.g. Data Engineer (title filter)'
                    : newSource === 'monster'
                      ? 'e.g. python|New York|en_us'
                      : newSource === 'jsearch' ||
                          newSource === 'jooble' ||
                          newSource === 'serpapi' ||
                          newSource === 'searchapi' ||
                          newSource === 'usajobs'
                        ? 'optional: search query'
                        : '—'
              }
              disabled={
                newSource === 'remoteok' ||
                newSource === 'adzuna' ||
                newSource === 'remotive' ||
                newSource === 'arbeitnow'
              }
              className="border border-border rounded-lg px-2 py-1.5 text-sm col-span-1 disabled:bg-hover"
            />
            <Button variant="primary" size="sm" onClick={add}>
              + Add
            </Button>
          </div>
          <p className="text-[11px] text-muted mt-2">
            Greenhouse / Lever slugs come from the careers URL — e.g.{' '}
            <span className="font-mono">boards.greenhouse.io/stripe</span> → slug{' '}
            <span className="font-mono">stripe</span>.
          </p>
        </div>

        {/* Per-driver health summary */}
        {!loading && health.length > 0 && (
          <div className="p-5 border-b border-border">
            <div className="text-[10px] font-semibold tracking-widest text-muted uppercase mb-2">
              Driver health
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {health.map((h) => (
                <div key={h.source} className="flex items-center gap-2 text-xs">
                  <span
                    className={clsx(
                      'w-2 h-2 rounded-full shrink-0',
                      h.status === 'ok'
                        ? 'bg-emerald-500'
                        : h.status === 'missing_key'
                          ? 'bg-amber-500'
                          : h.status === 'no_rows'
                            ? 'bg-muted'
                            : 'bg-rose-500',
                    )}
                  />
                  <span className="font-medium text-ink w-20 truncate">{h.source}</span>
                  <span className="text-muted">
                    {h.status === 'missing_key' && '⚠ API key missing'}
                    {h.status === 'no_rows' && 'no rows seeded'}
                    {h.status === 'error' && (h.last_error?.slice(0, 60) ?? 'error')}
                    {h.status === 'ok' &&
                      `${h.rows_active}/${h.rows_total} active · ${h.last_sync_jobs_count} jobs`}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Existing sources */}
        {loading ? (
          <div className="p-4">
            <SkeletonCard lines={4} />
          </div>
        ) : (
          <div className="divide-y divide-border">
            {rows.length === 0 && (
              <div className="p-6 text-sm text-muted italic text-center">
                No sources configured yet.
              </div>
            )}
            {rows.map((c) => (
              <div key={c.id} className="p-4 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <SourceBadge source={c.source} />
                    <span className="text-sm font-medium text-ink truncate">
                      {c.display_name ?? c.slug ?? c.source}
                    </span>
                    {!c.is_active && (
                      <span className="text-[10px] text-muted uppercase tracking-wide">Paused</span>
                    )}
                  </div>
                  <div className="text-xs text-muted mt-0.5">
                    {c.slug && <span className="font-mono">{c.slug}</span>}
                    {c.last_synced_at ? (
                      <>
                        {' '}
                        · Last sync {new Date(c.last_synced_at).toLocaleString()} ·{' '}
                        {c.last_sync_jobs_count ?? 0} jobs
                      </>
                    ) : (
                      <> · Never synced</>
                    )}
                  </div>
                  {c.last_sync_error && (
                    <p
                      className="text-[11px] text-red-600 dark:text-red-400 mt-1 truncate"
                      title={c.last_sync_error}
                    >
                      ⚠ {c.last_sync_error}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => syncOne(c.id)}
                    disabled={busy === c.id}
                    loading={busy === c.id}
                  >
                    {busy === c.id ? '…' : 'Sync'}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => toggle(c)}>
                    {c.is_active ? 'Pause' : 'Resume'}
                  </Button>
                  <Button variant="danger-ghost" size="sm" onClick={() => remove(c)}>
                    Remove
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
