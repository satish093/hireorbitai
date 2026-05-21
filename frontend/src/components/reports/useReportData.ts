import { useEffect, useState } from 'react';
import { api } from '../../services/api';
import { useReportContext } from './ReportContext';
import type { ReportPayloadMap, ReportTab } from './types';
// TODO: replace these mock fallbacks with the real /reports/<tab> endpoints
// once the backend ships them. Each tab tries GET /reports/<tab> first and only
// falls back to the bundled mock when that request fails (e.g. 404).
import pipeline from '../../mocks/reports/pipeline.json';
import recruiters from '../../mocks/reports/recruiters.json';
import consultants from '../../mocks/reports/consultants.json';
import placements from '../../mocks/reports/placements.json';
import sources from '../../mocks/reports/sources.json';
import ai from '../../mocks/reports/ai.json';

const MOCKS = {
  pipeline,
  recruiters,
  consultants,
  placements,
  sources,
  ai,
} as unknown as ReportPayloadMap;

export function useReportData<T extends ReportTab>(
  tab: T,
  enabled = true,
): { data: ReportPayloadMap[T] | null; loading: boolean } {
  const { resolved, compareToPrior } = useReportContext();
  // Tag the loaded payload with the tab it belongs to so a stale payload from
  // the previous tab is never handed to the new tab's component (which would
  // read a field of the wrong shape). Use an `alive` flag rather than an
  // AbortController so a fast unmount/remount (React StrictMode) doesn't cancel
  // the only in-flight request — stale results are simply ignored.
  const [loaded, setLoaded] = useState<{ tab: ReportTab; payload: unknown } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    api
      .get(`/reports/${tab}`, { params: { range: resolved.param, compareToPrior } })
      .then((r) => {
        if (alive) setLoaded({ tab, payload: r.data });
      })
      .catch(() => {
        if (alive) setLoaded({ tab, payload: MOCKS[tab] }); // endpoint not built → mock
      });
    return () => {
      alive = false;
    };
    // resolved.from/to cover custom-range changes (same param key 'custom').
  }, [tab, enabled, resolved.param, resolved.from, resolved.to, compareToPrior]);

  const data = loaded && loaded.tab === tab ? (loaded.payload as ReportPayloadMap[T]) : null;
  return { data, loading: data === null };
}
