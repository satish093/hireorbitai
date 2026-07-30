/**
 * Group directory — GET /user-groups.
 *
 * Two jobs, both needed by the talent directories:
 *   - resolve a `group_id` (UUID) to a display name — the API returns only the
 *     id on user/recruiter/manager rows, exactly like the web, which resolves it
 *     via <GroupBadge> + useUserGroups(). Without this the detail sheets can only
 *     show a raw UUID.
 *   - back the "move to group" picker with the same list.
 *
 * The endpoint is open to any authenticated user but SCOPED server-side: an
 * operator sees every group, everyone else only their own. That's fine — the
 * resolver just returns null (→ "—") for ids it can't see.
 */
import { useCallback, useMemo } from 'react';
import { useApiList } from './useApi';
import type { SelectOption } from '../components/ui/Inputs';

export interface UserGroup {
  id: string;
  name: string;
  color?: string | null;
  member_count?: number | null;
}

export function useGroups() {
  const { items, loading, error, refetch } = useApiList<UserGroup>('/user-groups', {
    channel: 'user-groups',
  });

  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of items) m.set(g.id, g.name);
    return m;
  }, [items]);

  const groupName = useCallback(
    (id?: string | null): string | null => (id ? (nameById.get(id) ?? null) : null),
    [nameById],
  );

  /** Options for a SelectInput. `includeNone` prepends an "Unassigned" choice. */
  const options = useCallback(
    (includeNone = false): SelectOption[] => {
      const base = items.map((g) => ({ value: g.id, label: g.name }));
      return includeNone ? [{ value: '', label: 'Unassigned (no group)' }, ...base] : base;
    },
    [items],
  );

  return { groups: items, groupName, options, loading, error, refetch };
}
