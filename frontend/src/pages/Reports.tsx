import { useSearchParams } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { PageHeader } from '../components/PageHeader';
import { ReportProvider } from '../components/reports/ReportContext';
import { ReportControls } from '../components/reports/ReportControls';
import { ReportTabs } from '../components/reports/ReportTabs';
import { KpiRow } from '../components/reports/KpiCard';
import { EmptyChart } from '../components/reports/EmptyChart';
import { useReportData } from '../components/reports/useReportData';
import { downloadCsv, payloadToCsvRows, exportPanelPng } from '../components/reports/exportUtils';
import { REPORT_TABS, type Kpi, type ReportTab } from '../components/reports/types';

const TAB_KEYS = REPORT_TABS.map((t) => t.key);
const isTab = (v: string | null): v is ReportTab => !!v && (TAB_KEYS as string[]).includes(v);

function ReportsInner() {
  const [params, setParams] = useSearchParams();
  const tab: ReportTab = isTab(params.get('tab')) ? (params.get('tab') as ReportTab) : 'pipeline';
  const setTab = (t: ReportTab) => {
    const next = new URLSearchParams(params);
    next.set('tab', t);
    setParams(next);
  };

  const { data, loading } = useReportData(tab);

  function handleExport(fmt: 'csv' | 'png') {
    if (fmt === 'png') {
      void exportPanelPng('report-panel', `report-${tab}.png`);
      return;
    }
    downloadCsv(`report-${tab}.csv`, payloadToCsvRows(data));
  }

  const kpis = (data as { kpis?: Kpi[] } | null)?.kpis ?? [];

  return (
    <Layout title="Reports">
      <PageHeader
        title="Reports"
        description="Analytics across pipeline, recruiters, consultants, placements, sources, and AI usage."
        action={<ReportControls onExport={handleExport} />}
      />

      <div className="mb-5">
        <ReportTabs tab={tab} onTab={setTab} />
      </div>

      <div id="report-panel" className="space-y-6">
        {loading ? (
          <EmptyChart message="Loading…" />
        ) : kpis.length === 0 ? (
          <EmptyChart />
        ) : (
          <>
            <KpiRow kpis={kpis} />
            <EmptyChart message="Charts for this tab are coming up." />
          </>
        )}
      </div>
    </Layout>
  );
}

export function Reports() {
  return (
    <ReportProvider>
      <ReportsInner />
    </ReportProvider>
  );
}
