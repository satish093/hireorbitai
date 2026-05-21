import { useEffect, useRef, useState } from 'react';
import { api } from '../services/api';
import { TaskStatus, TaskPriority } from '../types';
import toast from 'react-hot-toast';
import clsx from 'clsx';

// ---------------------------------------------------------------------------
// Saved filters dropdown for the Tasks page.
//
// Renders a single chip-style trigger next to the existing FilterBar. The
// popover lets users load, save, rename, delete, and default-pin filters.
// Parent owns the live filter state — this component just sends + receives
// FilterCriteria via callbacks.
// ---------------------------------------------------------------------------

export interface FilterCriteria {
  status?: TaskStatus;
  priority?: TaskPriority;
  assignee_id?: string;
  consultant_id?: string;
  recruiter_id?: string;
  q?: string;
  overdue?: boolean;
}

interface SavedFilter {
  id: string;
  name: string;
  criteria: FilterCriteria;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

interface Props {
  current: FilterCriteria;
  onApply: (criteria: FilterCriteria) => void;
  // Fired once on mount after the default (if any) is loaded, so the parent
  // can hydrate filter state from the user's pinned default without re-firing.
  onLoadDefault?: (criteria: FilterCriteria) => void;
}

export function SavedTaskFilters({ current, onApply, onLoadDefault }: Props) {
  const [filters, setFilters] = useState<SavedFilter[]>([]);
  const [open, setOpen] = useState(false);
  const [saveMode, setSaveMode] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [loading, setLoading] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const defaultLoadedRef = useRef(false);

  async function load() {
    try {
      const r = await api.get('/tasks/filters');
      const rows = (r.data ?? []) as SavedFilter[];
      setFilters(rows);
      if (!defaultLoadedRef.current && onLoadDefault) {
        defaultLoadedRef.current = true;
        const def = rows.find((f) => f.is_default);
        if (def) onLoadDefault(def.criteria);
      }
    } catch (e: unknown) {
      // Soft failure — the dropdown still works, just empty. Don't toast on
      // page load (would spam users when the migration hasn't run yet).
      const msg = e instanceof Error ? e.message : '';
      if (msg) console.warn('saved filters load failed:', msg);
    }
  }

  useEffect(() => {
    load();
    // Run-once intentionally — onLoadDefault should fire on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Click-outside dismissal.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSaveMode(false);
        setRenameId(null);
      }
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  async function save() {
    const name = saveName.trim();
    if (!name) {
      toast.error('Name is required');
      return;
    }
    setLoading(true);
    try {
      const r = await api.post('/tasks/filters', { name, criteria: stripCriteria(current) });
      setFilters((prev) => [r.data, ...prev]);
      setSaveMode(false);
      setSaveName('');
      toast.success('Filter saved');
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        'Failed to save filter';
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  async function rename(id: string) {
    const name = renameValue.trim();
    if (!name) return;
    try {
      const r = await api.patch(`/tasks/filters/${id}`, { name });
      setFilters((prev) => prev.map((f) => (f.id === id ? r.data : f)));
      setRenameId(null);
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        'Rename failed';
      toast.error(msg);
    }
  }

  async function setDefault(id: string, value: boolean) {
    try {
      const r = await api.patch(`/tasks/filters/${id}`, { is_default: value });
      // The PATCH clears other defaults server-side, so reload to stay
      // consistent rather than guessing local state.
      setFilters((prev) =>
        prev.map((f) => {
          if (f.id === id) return r.data;
          if (value && f.is_default) return { ...f, is_default: false };
          return f;
        }),
      );
    } catch {
      toast.error('Could not update default');
    }
  }

  async function remove(id: string) {
    if (!confirm('Delete this saved filter?')) return;
    try {
      await api.delete(`/tasks/filters/${id}`);
      setFilters((prev) => prev.filter((f) => f.id !== id));
    } catch {
      toast.error('Delete failed');
    }
  }

  const activeCount = countActive(current);

  return (
    <div className="relative" ref={popoverRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm',
          open ? 'bg-ink border-ink text-bg' : 'bg-surface border-border text-ink hover:bg-hover',
        )}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span>☆ Saved</span>
        {filters.length > 0 && (
          <span
            className={clsx(
              'text-[10px] font-semibold px-1.5 py-0.5 rounded-full tabular-nums',
              // On the open button (bg-ink, which inverts per theme) use
              // literal black/white with opacity — semantic tokens can't take an
              // opacity modifier (var() colors have no <alpha-value> channel).
              open
                ? 'bg-white/20 text-white dark:bg-black/20 dark:text-black'
                : 'bg-hover text-muted',
            )}
          >
            {filters.length}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute z-30 mt-2 right-0 w-80 bg-surface border border-border rounded-xl shadow-lg overflow-hidden"
        >
          <div className="px-3 py-2 border-b border-border flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted">
              My saved filters
            </span>
            <button
              onClick={() => {
                setSaveMode(true);
                setSaveName('');
              }}
              disabled={activeCount === 0}
              className="text-xs text-brand-600 hover:text-brand-700 disabled:text-muted"
              title={activeCount === 0 ? 'Set some filters first' : 'Save current filters'}
            >
              + Save current
            </button>
          </div>

          {saveMode && (
            <div className="px-3 py-2 border-b border-border bg-hover">
              <input
                autoFocus
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') save();
                  if (e.key === 'Escape') {
                    setSaveMode(false);
                    setSaveName('');
                  }
                }}
                placeholder="Filter name (e.g. My open critical)"
                className="w-full border border-border rounded-md px-2 py-1 text-sm bg-surface outline-none focus:ring-2 focus:ring-brand-500/30"
              />
              <div className="mt-1.5 flex items-center justify-end gap-2">
                <button
                  onClick={() => {
                    setSaveMode(false);
                    setSaveName('');
                  }}
                  className="text-xs text-muted hover:text-ink"
                >
                  Cancel
                </button>
                <button
                  onClick={save}
                  disabled={loading || !saveName.trim()}
                  className="text-xs bg-ink text-bg px-2.5 py-1 rounded-md disabled:opacity-50"
                >
                  Save
                </button>
              </div>
            </div>
          )}

          <div className="max-h-64 overflow-y-auto">
            {filters.length === 0 && !saveMode && (
              <div className="px-3 py-4 text-sm text-muted italic">
                No saved filters yet. Set your filters then click “Save current”.
              </div>
            )}
            {filters.map((f) => (
              <div key={f.id} className="group px-3 py-2 hover:bg-hover flex items-center gap-2">
                {renameId === f.id ? (
                  <>
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') rename(f.id);
                        if (e.key === 'Escape') setRenameId(null);
                      }}
                      className="flex-1 border border-border rounded-md px-2 py-1 text-sm bg-surface outline-none focus:ring-2 focus:ring-brand-500/30"
                    />
                    <button
                      onClick={() => rename(f.id)}
                      className="text-xs text-brand-600 hover:text-brand-700"
                    >
                      Save
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => {
                        onApply(f.criteria);
                        setOpen(false);
                      }}
                      className="flex-1 text-left text-sm text-ink truncate"
                    >
                      <span className="inline-flex items-center gap-1.5">
                        {f.is_default && (
                          <span title="Default filter" className="text-amber-500">
                            ★
                          </span>
                        )}
                        <span>{f.name}</span>
                      </span>
                      <div className="text-[11px] text-muted truncate">{summarize(f.criteria)}</div>
                    </button>
                    <div className="opacity-0 group-hover:opacity-100 transition flex items-center gap-1">
                      <button
                        onClick={() => setDefault(f.id, !f.is_default)}
                        title={f.is_default ? 'Unset as default' : 'Set as default'}
                        className="text-xs text-muted hover:text-amber-500"
                      >
                        {f.is_default ? '★' : '☆'}
                      </button>
                      <button
                        onClick={() => {
                          setRenameId(f.id);
                          setRenameValue(f.name);
                        }}
                        title="Rename"
                        className="text-xs text-muted hover:text-ink"
                      >
                        ✎
                      </button>
                      <button
                        onClick={() => remove(f.id)}
                        title="Delete"
                        className="text-xs text-muted hover:text-red-600"
                      >
                        ×
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Empty strings and falsy `overdue` values get stripped before persisting so
// the saved criteria reflects only the active filters.
function stripCriteria(c: FilterCriteria): FilterCriteria {
  const out: FilterCriteria = {};
  if (c.status) out.status = c.status;
  if (c.priority) out.priority = c.priority;
  if (c.assignee_id) out.assignee_id = c.assignee_id;
  if (c.consultant_id) out.consultant_id = c.consultant_id;
  if (c.recruiter_id) out.recruiter_id = c.recruiter_id;
  if (c.q && c.q.trim()) out.q = c.q.trim();
  if (c.overdue) out.overdue = true;
  return out;
}

function countActive(c: FilterCriteria): number {
  return Object.values(stripCriteria(c)).filter((v) => v !== undefined && v !== '').length;
}

function summarize(c: FilterCriteria): string {
  const parts: string[] = [];
  if (c.status) parts.push(c.status);
  if (c.priority) parts.push(c.priority);
  if (c.assignee_id) parts.push('assignee');
  if (c.overdue) parts.push('overdue');
  if (c.q) parts.push(`"${c.q}"`);
  return parts.length ? parts.join(' · ') : 'No filters';
}
