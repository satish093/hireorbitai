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

const MOCKS = {
  pipeline,
  recruiters,
  consultants,
  placements,
  sources,
} as unknown as ReportPayloadMap;

export function useReportData<T extends ReportTab>(
  tab: T,
  enabled = true,
): { data: ReportPayloadMap[T] | null; loading: boolean; isMock: boolean; error: string | null } {
  const { resolved, compareToPrior } = useReportContext();
  // Tag the loaded payload with the tab it belongs to so a stale payload from
  // the previous tab is never handed to the new tab's component (which would
  // read a field of the wrong shape). Use an `alive` flag rather than an
  // AbortController so a fast unmount/remount (React StrictMode) doesn't cancel
  // the only in-flight request — stale results are simply ignored.
  const [loaded, setLoaded] = useState<{
    tab: ReportTab;
    payload: unknown;
    isMock: boolean;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    setError(null);
    api
      .get(`/reports/${tab}`, { params: { range: resolved.param, compareToPrior } })
      .then((r) => {
        if (alive) setLoaded({ tab, payload: r.data, isMock: false });
      })
      .catch((e) => {
        if (!alive) return;
        const status = (e?.response?.status as number | undefined) ?? 0;
        // 404 is the only case where the bundled mock is a reasonable
        // dev-time fallback ("backend endpoint not built yet"). Any other
        // failure (5xx, 403, network) MUST surface as an error — execs were
        // previously shown fabricated numbers when the API was down because
        // every catch path silently replaced the payload with MOCKS[tab].
        if (status === 404) {
          setLoaded({ tab, payload: MOCKS[tab], isMock: true });
        } else {
          setLoaded(null);
          setError(
            (e?.response?.data?.error as string | undefined) ??
              `Couldn't load ${tab} report. Please try again.`,
          );
        }
      });
    return () => {
      alive = false;
    };
    // resolved.from/to cover custom-range changes (same param key 'custom').
  }, [tab, enabled, resolved.param, resolved.from, resolved.to, compareToPrior]);

  const data = loaded && loaded.tab === tab ? (loaded.payload as ReportPayloadMap[T]) : null;
  const isMock = loaded?.tab === tab ? loaded.isMock : false;
  return { data, loading: data === null && error === null, isMock, error };
}
