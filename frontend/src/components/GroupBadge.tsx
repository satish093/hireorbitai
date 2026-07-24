import { useEffect, useState } from 'react';
import { api } from '../services/api';

// Shared shape used across every page that shows a user.
export interface GroupLite {
  id: string;
  name: string;
  color?: string | null;
  unique_group_id?: string | null;
  // Short-lived signed URL for the group's company logo (minted server-side per
  // /user-groups response). Null/absent → fall back to the color dot.
  logo_url?: string | null;
}

// Module-level cache. The first component that mounts kicks off the fetch;
// every other component subscribes to the resolved list. Avoids N concurrent
// requests when 10+ surfaces all mount at once (e.g. dashboard sidebar widgets).
let cache: GroupLite[] | null = null;
let inflight: Promise<GroupLite[]> | null = null;
const subscribers = new Set<(g: GroupLite[]) => void>();

function fetchGroups(): Promise<GroupLite[]> {
  if (cache) return Promise.resolve(cache);
  if (inflight) return inflight;
  inflight = api
    .get<GroupLite[]>('/user-groups')
    .then((r) => {
      cache = r.data ?? [];
      inflight = null;
      for (const fn of subscribers) fn(cache);
      return cache;
    })
    .catch(() => {
      // Treat fetch failure as "no groups" so callers fall back to "No Group"
      // labels instead of crashing. Don't cache the empty array — a real
      // failure should still retry on next mount.
      inflight = null;
      return [];
    });
  return inflight;
}

/**
 * Returns the current groups list + a lookup map. Triggers a single fetch on
 * first use; subsequent callers reuse the cached result. Use `invalidate()`
 * (exported) after a group create/update/delete to flush the cache.
 */
export function useUserGroups(): {
  groups: GroupLite[];
  byId: Record<string, GroupLite>;
  loading: boolean;
} {
  const [groups, setGroups] = useState<GroupLite[]>(cache ?? []);
  const [loading, setLoading] = useState<boolean>(cache === null);
  useEffect(() => {
    if (cache) {
      setGroups(cache);
      setLoading(false);
      return;
    }
    let active = true;
    const fn = (g: GroupLite[]) => {
      if (active) {
        setGroups(g);
        setLoading(false);
      }
    };
    subscribers.add(fn);
    void fetchGroups().then(fn);
    return () => {
      active = false;
      subscribers.delete(fn);
    };
  }, []);
  const byId: Record<string, GroupLite> = {};
  for (const g of groups) byId[g.id] = g;
  return { groups, byId, loading };
}

/**
 * Drop the in-memory cache. Call after group create/update/delete so other
 * mounted components refetch on their next render.
 */
export function invalidateUserGroupsCache(): void {
  cache = null;
  // Trigger refetch and broadcast to anyone listening.
  void fetchGroups();
}

interface GroupBadgeProps {
  groupId: string | null | undefined;
  /** Tiny variant: just the colored dot, no name. Used in dense table cells. */
  compact?: boolean;
  /** Hide entirely when the user has no group. Default: show "No Group" italic. */
  hideEmpty?: boolean;
  className?: string;
}

/**
 * Renders the colored group badge for a user. Resolves the group via the
 * shared cache so it's safe to drop into every row of a long list without
 * triggering one request per row.
 *
 * Falls back to an italic "No Group" label when groupId is null/undefined
 * (or hides itself entirely if hideEmpty is set).
 */
export function GroupBadge({ groupId, compact, hideEmpty, className }: GroupBadgeProps) {
  const { byId } = useUserGroups();
  if (!groupId) {
    if (hideEmpty) return null;
    return (
      <span className={`text-[11px] text-muted italic ${className ?? ''}`.trim()}>No Group</span>
    );
  }
  const g = byId[groupId];
  if (!g) {
    // Cache hasn't loaded yet OR group was deleted while still referenced.
    if (hideEmpty) return null;
    return <span className={`text-[11px] text-muted ${className ?? ''}`.trim()}>—</span>;
  }
  const color = g.color ?? '#6366F1';
  const title = `${g.name}${g.unique_group_id ? ` (${g.unique_group_id})` : ''}`;
  // Company logos are intentionally NOT shown in directory badges — the uploaded
  // logo is used only on invoices. Everywhere a group is referenced in-app we
  // show the company NAME (with a small colored dot), never the logo image.
  if (compact) {
    return (
      <span
        className={`inline-flex items-center gap-1 text-[11px] font-medium text-ink-2 animate-fade-in ${className ?? ''}`.trim()}
        title={title}
      >
        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
        {g.name}
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded text-[11px] font-medium animate-fade-in ${className ?? ''}`.trim()}
      style={{ background: `${color}1A`, color }}
      title={g.unique_group_id ?? undefined}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
      {g.name}
    </span>
  );
}
