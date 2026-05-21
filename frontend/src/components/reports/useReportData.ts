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
): { data: ReportPayloadMap[T] | null; loading: boolean } {
  const { resolved, compareToPrior } = useReportContext();
  const [data, setData] = useState<ReportPayloadMap[T] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setData(null);
    api
      .get(`/reports/${tab}`, {
        params: { range: resolved.param, compareToPrior },
        signal: controller.signal,
      })
      .then((r) => {
        if (!controller.signal.aborted) setData(r.data as ReportPayloadMap[T]);
      })
      .catch((e) => {
        if (e?.code === 'ERR_CANCELED' || controller.signal.aborted) return;
        setData(MOCKS[tab]); // endpoint not built yet → mock
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
    // resolved.from/to cover custom-range changes (same param key 'custom').
  }, [tab, resolved.param, resolved.from, resolved.to, compareToPrior]);

  return { data, loading };
}
