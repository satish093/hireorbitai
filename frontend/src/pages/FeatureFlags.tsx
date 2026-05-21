import { useEffect, useState } from 'react';
import { Layout } from '../components/Layout';
import { SkeletonCard } from '../components/Skeleton';
import { Button } from '../components/Button';
import { api } from '../services/api';
import { useFeatureFlags } from '../hooks/useFeatureFlags';
import { invalidate } from '../hooks/useInvalidate';
import toast from 'react-hot-toast';
import clsx from 'clsx';

interface FlagRow {
  key: string;
  enabled: boolean;
  description?: string | null;
  updated_at?: string;
  updated_by?: string | null;
}

interface GroupLite {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
}
interface OverrideRow {
  group_id: string;
  key: string;
  enabled: boolean;
}

export function FeatureFlags() {
  const [rows, setRows] = useState<FlagRow[]>([]);
  const [groups, setGroups] = useState<GroupLite[]>([]);
  const [overrides, setOverrides] = useState<OverrideRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const { refresh } = useFeatureFlags();

  async function load() {
    setLoading(true);
    try {
      const [flagsR, groupsR, ovR] = await Promise.all([
        api.get('/feature-flags'),
        api.get('/user-groups').catch(() => ({ data: [] })),
        api.get('/feature-flags/overrides').catch(() => ({ data: [] })),
      ]);
      setRows(flagsR.data ?? []);
      setGroups((groupsR.data ?? []).filter((g: GroupLite) => g.is_active));
      setOverrides(ovR.data ?? []);
    } catch (e: any) {
      toast.error(
        e?.response?.data?.error ?? 'Failed to load feature flags (run database/feature-flags.sql)',
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  /** null = inherit global, true/false = override. Three-state cycle on click. */
  function overrideFor(groupId: string, key: string): boolean | null {
    const r = overrides.find((o) => o.group_id === groupId && o.key === key);
    return r ? r.enabled : null;
  }

  async function cycleOverride(groupId: string, key: string) {
    const current = overrideFor(groupId, key);
    // null → true → false → null
    const next: boolean | null = current === null ? true : current === true ? false : null;
    const id = `${groupId}|${key}`;
    setSaving(id);
    // Optimistic.
    setOverrides((rs) => {
      const without = rs.filter((o) => !(o.group_id === groupId && o.key === key));
      return next === null ? without : [...without, { group_id: groupId, key, enabled: next }];
    });
    try {
      await api.put(`/feature-flags/groups/${groupId}/${key}`, { enabled: next });
      await refresh();
      invalidate('feature-flags');
      // Same as the global toggle: reload so every component picks up the
      // new override without depending on per-component re-render hooks.
      window.location.reload();
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to update override');
      // Reload to rebuild canonical state on failure.
      load();
    } finally {
      setSaving(null);
    }
  }

  async function toggle(row: FlagRow) {
    setSaving(row.key);
    const previous = row.enabled;
    // Optimistic update.
    setRows((rs) => rs.map((r) => (r.key === row.key ? { ...r, enabled: !previous } : r)));
    try {
      await api.patch(`/feature-flags/${row.key}`, { enabled: !previous });
      await refresh();
      invalidate('feature-flags');
      // Hard-reload the page so the sidebar, route guards, and every
      // open module reflect the new flag state without any caching or
      // stale-context concerns. The in-memory invalidate() above already
      // updates the local context — the reload guarantees nothing
      // residual is showing the old value (e.g. an already-mounted
      // page that doesn't re-render on flag changes).
      window.location.reload();
    } catch (e: any) {
      // Roll back.
      setRows((rs) => rs.map((r) => (r.key === row.key ? { ...r, enabled: previous } : r)));
      toast.error(e?.response?.data?.error ?? 'Failed to update flag');
    } finally {
      setSaving(null);
    }
  }

  return (
    <Layout
      title="Feature flags"
      crumbs={[{ label: 'Workspace', to: '/dashboard' }, { label: 'Admin' }, { label: 'Features' }]}
    >
      <div className="max-w-5xl">
        <h1 className="text-2xl font-semibold tracking-tight text-ink mb-1">Feature flags</h1>
        <p className="text-sm text-muted mb-6">
          Toggle modules across the entire workspace. Changes apply on next page load for users
          (sidebar refreshes automatically). Per-group overrides below let you enable or disable a
          feature for a specific user group without affecting everyone else.
        </p>

        {loading ? (
          <SkeletonCard lines={5} />
        ) : rows.length === 0 ? (
          <div className="bg-surface border border-amber-200 dark:border-amber-500/30 rounded-xl p-5 text-sm text-amber-900">
            No feature flags exist yet. Run{' '}
            <span className="font-mono">database/feature-flags.sql</span> against your database to
            seed the table.
          </div>
        ) : (
          <div className="bg-surface border border-border rounded-xl divide-y divide-border">
            {rows.map((r) => (
              <div key={r.key} className="px-5 py-4 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-ink">{prettyKey(r.key)}</div>
                  {r.description && (
                    <div className="text-xs text-muted mt-0.5">{r.description}</div>
                  )}
                  <div className="text-[10px] text-muted mt-1 font-mono">{r.key}</div>
                </div>
                <Toggle
                  on={r.enabled}
                  disabled={saving === r.key}
                  onClick={() => toggle(r)}
                  label={r.enabled ? 'Enabled' : 'Disabled'}
                />
              </div>
            ))}
          </div>
        )}

        {/* Per-group override matrix */}
        {!loading && rows.length > 0 && groups.length > 0 && (
          <div className="mt-10">
            <h2 className="text-lg font-semibold tracking-tight text-ink mb-1">
              Per-group overrides
            </h2>
            <p className="text-sm text-muted mb-3">
              Click a cell to cycle through <strong>inherit → enabled → disabled → inherit</strong>.
              "Inherit" means the cell follows whatever the global flag above is set to.
            </p>
            <div className="bg-surface border border-border rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-hover border-b border-border">
                    <tr>
                      <th className="text-left text-[11px] uppercase tracking-widest text-muted font-semibold px-4 py-2.5">
                        Feature
                      </th>
                      {groups.map((g) => (
                        <th
                          key={g.id}
                          className="text-center text-[11px] uppercase tracking-widest text-muted font-semibold px-3 py-2.5 whitespace-nowrap"
                        >
                          {g.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {rows.map((r) => (
                      <tr key={r.key}>
                        <td className="px-4 py-2.5">
                          <div className="text-sm font-medium text-ink">{prettyKey(r.key)}</div>
                          <div className="text-[10px] font-mono text-muted">{r.key}</div>
                        </td>
                        {groups.map((g) => {
                          const state = overrideFor(g.id, r.key);
                          const id = `${g.id}|${r.key}`;
                          return (
                            <td key={g.id} className="text-center px-3 py-2.5">
                              <OverrideCell
                                state={state}
                                disabled={saving === id}
                                onClick={() => cycleOverride(g.id, r.key)}
                              />
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}

function OverrideCell({
  state,
  onClick,
  disabled,
}: {
  state: boolean | null;
  onClick: () => void;
  disabled?: boolean;
}) {
  const tone =
    state === true
      ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30'
      : state === false
        ? 'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300 border-red-200 dark:border-red-500/30'
        : 'bg-hover text-muted border-border';
  const label = state === true ? 'On' : state === false ? 'Off' : 'Inherit';
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        'inline-flex items-center justify-center text-[11px] font-semibold uppercase tracking-wide border rounded-full px-2 py-0.5 min-w-[60px] transition',
        tone,
      )}
      title="Click to cycle inherit → on → off"
    >
      {label}
    </Button>
  );
}

function prettyKey(k: string): string {
  return k
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function Toggle({
  on,
  onClick,
  disabled,
  label,
}: {
  on: boolean;
  onClick: () => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        'inline-flex items-center gap-2 px-1 py-1 rounded-full transition disabled:opacity-50',
        on ? 'bg-emerald-500' : 'bg-muted',
      )}
      style={{ width: 44 }}
      aria-label={label}
    >
      <span
        className={clsx(
          'w-4 h-4 rounded-full bg-surface shadow transition',
          on ? 'translate-x-5' : 'translate-x-0',
        )}
      />
    </button>
  );
}
