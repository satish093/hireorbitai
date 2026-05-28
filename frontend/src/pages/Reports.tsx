import { useSearchParams } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { PageHeader } from '../components/PageHeader';
import { ReportProvider } from '../components/reports/ReportContext';
import { ReportControls } from '../components/reports/ReportControls';
import { ReportTabs } from '../components/reports/ReportTabs';
import { useReportData } from '../components/reports/useReportData';
import { downloadCsv, payloadToCsvRows, exportPanelPng } from '../components/reports/exportUtils';
import {
  NAV_TABS,
  isAnalyticsTab,
  visibleTabsForRole,
  defaultTabForRole,
  type PageTab,
  type ReportTab,
} from '../components/reports/types';
import { useAuth } from '../context/AuthContext';
import type {
  PipelinePayload,
  RecruitersPayload,
  ConsultantsPayload,
  PlacementsPayload,
  SourcesPayload,
  AIUsagePayload,
} from '../components/reports/types';
import { PipelineReport } from '../components/reports/PipelineReport';
import { RecruiterReport } from '../components/reports/RecruiterReport';
import { ConsultantReport } from '../components/reports/ConsultantReport';
import { PlacementsReport } from '../components/reports/PlacementsReport';
import { SourcesReport } from '../components/reports/SourcesReport';
import { AIUsageReport } from '../components/reports/AIUsageReport';
import { DailyActivityReport } from '../components/reports/DailyActivityReport';
import { TimeInAppReport } from '../components/reports/TimeInAppReport';
import { SubmissionsReport } from '../components/reports/SubmissionsReport';

const TAB_KEYS = NAV_TABS.map((t) => t.key);
const isTab = (v: string | null): v is PageTab => !!v && (TAB_KEYS as string[]).includes(v);

function ReportsInner() {
  const [params, setParams] = useSearchParams();
  const { profile } = useAuth();
  const role = profile?.role ?? null;
  // Tabs this caller is allowed to see. A RECRUITER only gets the two
  // self-scoped tabs (submissions, daily log); managers + admins see
  // everything. The active tab from the URL is clamped to this set so a
  // recruiter who navigates directly to /reports?tab=pipeline is bounced
  // to their default.
  const allowedTabs = visibleTabsForRole(role);
  const allowedKeys = new Set(allowedTabs.map((t) => t.key));
  const fallback = defaultTabForRole(role);
  const urlTab = isTab(params.get('tab')) ? (params.get('tab') as PageTab) : fallback;
  const tab: PageTab = allowedKeys.has(urlTab) ? urlTab : fallback;
  const setTab = (t: PageTab) => {
    if (!allowedKeys.has(t)) return;
    const next = new URLSearchParams(params);
    next.set('tab', t);
    setParams(next);
  };

  const analyticsTab: ReportTab | null = isAnalyticsTab(tab) ? tab : null;
  const { data, loading } = useReportData(analyticsTab ?? 'pipeline', analyticsTab !== null);

  function handleExport(fmt: 'csv' | 'png') {
    if (fmt === 'png') {
      void exportPanelPng('report-panel', `report-${tab}.png`);
      return;
    }
    downloadCsv(`report-${tab}.csv`, payloadToCsvRows(data));
  }

  return (
    <Layout title="Reports">
      <PageHeader
        title="Reports"
        description="Analytics across pipeline, recruiters, consultants, placements, sources, and AI usage."
        action={<ReportControls onExport={handleExport} />}
      />

      <div className="mb-5">
        <ReportTabs tab={tab} onTab={setTab} tabs={allowedTabs} />
      </div>

      <div id="report-panel">
        {tab === 'pipeline' && (
          <PipelineReport data={data as PipelinePayload | null} loading={loading} />
        )}
        {tab === 'recruiters' && (
          <RecruiterReport data={data as RecruitersPayload | null} loading={loading} />
        )}
        {tab === 'consultants' && (
          <ConsultantReport data={data as ConsultantsPayload | null} loading={loading} />
        )}
        {tab === 'placements' && (
          <PlacementsReport data={data as PlacementsPayload | null} loading={loading} />
        )}
        {tab === 'sources' && (
          <SourcesReport data={data as SourcesPayload | null} loading={loading} />
        )}
        {tab === 'ai' && <AIUsageReport data={data as AIUsagePayload | null} loading={loading} />}
        {tab === 'submissions' && <SubmissionsReport />}
        {tab === 'daily' && <DailyActivityReport />}
        {tab === 'usertime' && <TimeInAppReport />}
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
