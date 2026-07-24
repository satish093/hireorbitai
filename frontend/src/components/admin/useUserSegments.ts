import { useMemo } from 'react';
import type { SegmentKey, UserKpi } from './types';

export interface Segment {
  key: SegmentKey;
  label: string;
  count: number;
}

/**
 * Derives the segment ribbon's labelled counts from the KPI payload. The KPI
 * endpoint computes these globally in one grouped scan, so the badges stay
 * accurate even though the table itself is server-paginated. (Deriving from
 * the loaded page would only count one page — wrong for any large workspace.)
 */
export function useUserSegments(kpi: UserKpi | null): Segment[] {
  return useMemo(() => {
    const k = kpi;
    return [
      { key: 'all', label: 'All', count: k?.total ?? 0 },
      { key: 'recruiters', label: 'Recruiters', count: k?.recruiters ?? 0 },
      { key: 'consultants', label: 'Consultants', count: k?.consultants ?? 0 },
      { key: 'managers', label: 'Managers + admins', count: k?.managers ?? 0 },
      { key: 'pending', label: 'Pending invites', count: k?.pending ?? 0 },
      { key: 'locked', label: 'Locked', count: k?.locked ?? 0 },
      { key: 'forced_reset', label: 'Forced password reset', count: k?.forced_reset ?? 0 },
      { key: 'no_login_30d', label: 'No login > 30d', count: k?.no_login_30d ?? 0 },
    ];
  }, [kpi]);
}
