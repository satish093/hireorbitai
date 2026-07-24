import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { type FilterState, type SavedView, type ViewMode } from './types';

// TODO: The /task-views endpoint may not exist yet on the backend. Until it is
// deployed, GET /task-views will return 404 and the hook falls back to the
// DEFAULT_VIEWS seed below. POST and DELETE will silently fail without
// crashing the UI.

function buildDefaultViews(profileId?: string): SavedView[] {
  return [
    {
      id: 'def-all-open',
      name: 'All open',
      filters: {},
      view_mode: 'kanban',
    },
    {
      id: 'def-my-week',
      name: 'My week',
      filters: profileId ? { assignee_id: profileId } : {},
      view_mode: 'table',
    },
    {
      id: 'def-interview',
      name: 'Interview prep',
      filters: { tag: 'interview' },
      view_mode: 'kanban',
    },
    {
      id: 'def-visa',
      name: 'Visa & compliance',
      filters: { tag: 'visa' },
      view_mode: 'table',
    },
    {
      id: 'def-stuck',
      name: 'Stuck > 3 days',
      filters: { overdue: true },
      view_mode: 'table',
    },
    {
      id: 'def-vendor',
      name: 'Vendor follow-ups',
      filters: { tag: 'vendor' },
      view_mode: 'kanban',
    },
  ];
}

interface ServerRow {
  id: string;
  name: string;
  filters_json?: FilterState | null;
  sort_by?: string | null;
  view_mode?: ViewMode | null;
  count?: number | null;
}

function mapRow(row: ServerRow): SavedView {
  return {
    id: String(row.id ?? ''),
    name: String(row.name ?? 'Untitled'),
    filters: row.filters_json ?? {},
    sort_by: row.sort_by ?? null,
    view_mode: row.view_mode ?? 'kanban',
    count: row.count ?? undefined,
  };
}

export function useSavedTaskViews(): {
  views: SavedView[];
  loading: boolean;
  saveView: (
    name: string,
    cfg: { filters: FilterState; sort_by?: string | null; view_mode: ViewMode },
  ) => Promise<void>;
  deleteView: (id: string) => Promise<void>;
  refetch: () => void;
} {
  const { profile } = useAuth();
  const [views, setViews] = useState<SavedView[]>(() => buildDefaultViews(profile?.id));
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  const refetch = useCallback(() => setTick((n) => n + 1), []);

  // Keep default views in sync if the profile resolves after initial render.
  const profileId = profile?.id;
  const defaultsRef = useRef<SavedView[]>(buildDefaultViews(profileId));
  useEffect(() => {
    defaultsRef.current = buildDefaultViews(profileId);
  }, [profileId]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      try {
        const r = await api.get('/task-views');
        if (cancelled) return;
        const rows: ServerRow[] = Array.isArray(r.data) ? r.data : [];
        if (rows.length === 0) {
          setViews(defaultsRef.current);
        } else {
          setViews(rows.map(mapRow));
        }
      } catch {
        // 404 means the endpoint is not deployed yet; any other error is also
        // handled gracefully by falling back to the seeded defaults.
        if (!cancelled) {
          setViews(defaultsRef.current);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [tick]);

  const saveView = useCallback(
    async (
      name: string,
      cfg: { filters: FilterState; sort_by?: string | null; view_mode: ViewMode },
    ): Promise<void> => {
      try {
        await api.post('/task-views', {
          name,
          filters_json: cfg.filters,
          sort_by: cfg.sort_by ?? null,
          view_mode: cfg.view_mode,
        });
        refetch();
      } catch (e: unknown) {
        const msg =
          (e as { response?: { data?: { error?: string } } })?.response?.data?.error ??
          'Failed to save view';
        toast.error(msg);
      }
    },
    [refetch],
  );

  const deleteView = useCallback(
    async (id: string): Promise<void> => {
      try {
        await api.delete(`/task-views/${id}`);
        refetch();
      } catch (e: unknown) {
        const msg =
          (e as { response?: { data?: { error?: string } } })?.response?.data?.error ??
          'Failed to delete view';
        toast.error(msg);
      }
    },
    [refetch],
  );

  return { views, loading, saveView, deleteView, refetch };
}
