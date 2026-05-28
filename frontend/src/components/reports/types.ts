// Shared types for the Reports analytics workspace.

export type ReportTab = 'pipeline' | 'recruiters' | 'consultants' | 'placements' | 'sources' | 'ai';

export const REPORT_TABS: { key: ReportTab; label: string }[] = [
  { key: 'pipeline', label: 'Pipeline' },
  { key: 'recruiters', label: 'Recruiters' },
  { key: 'consultants', label: 'Consultants' },
  { key: 'placements', label: 'Placements' },
  { key: 'sources', label: 'Sources' },
  { key: 'ai', label: 'AI usage' },
];

/**
 * Tabs shown in the nav. Superset of the analytics (payload-bearing) tabs plus
 * two bespoke tabs that self-fetch their own non-uniform data: the manual daily
 * activity log (a mutation surface) and the time-in-app report.
 */
export type PageTab = ReportTab | 'submissions' | 'daily' | 'usertime';

export const NAV_TABS: { key: PageTab; label: string }[] = [
  ...REPORT_TABS,
  { key: 'submissions', label: 'Submissions' },
  { key: 'daily', label: 'Daily log' },
  { key: 'usertime', label: 'Time in app' },
];

const ANALYTICS = new Set<string>(REPORT_TABS.map((t) => t.key));
export const isAnalyticsTab = (t: PageTab): t is ReportTab => ANALYTICS.has(t);

/**
 * Tabs a RECRUITER may navigate to. The backend already self-scopes the
 * rows on the submissions + daily endpoints, but the workspace-wide
 * analytics tabs (pipeline / recruiters / consultants / placements /
 * sources / ai / time-in-app) are manager-tier+. Strip them from the
 * recruiter's nav and clamp the active tab.
 */
export const RECRUITER_TABS: PageTab[] = ['submissions', 'daily'];

export function visibleTabsForRole(
  role: string | undefined | null,
): { key: PageTab; label: string }[] {
  if (role === 'RECRUITER') {
    return NAV_TABS.filter((t) => (RECRUITER_TABS as string[]).includes(t.key));
  }
  return NAV_TABS;
}

export function defaultTabForRole(role: string | undefined | null): PageTab {
  return role === 'RECRUITER' ? 'submissions' : 'pipeline';
}

export type RangeKey = '7d' | '30d' | '90d' | 'qtd' | 'ytd' | 'custom';

export interface CustomRange {
  from: string; // ISO date
  to: string; // ISO date
}

/** A resolved, concrete date window derived from the active RangeKey. */
export interface ResolvedRange {
  from: Date;
  to: Date;
  days: number;
  /** "Mar 17 — Jun 15 · 91 days" */
  label: string;
  /** The query-string value sent to the backend, e.g. "90d" or "custom". */
  param: string;
}

export interface Kpi {
  label: string;
  value: string;
  prior?: string;
  delta?: string;
  trend?: 'up' | 'down';
  positive?: boolean;
  helpText?: string;
}

// --- Chart data shapes (mirrored by the mock JSON + the eventual backend) ----

export interface FunnelStage {
  stage: string; // 'Sourced' | 'Submitted' | ...
  count: number;
  pct: number; // % of the top of funnel
  dropPct?: number; // drop-off vs the previous stage
}

export interface AreaPoint {
  date: string; // ISO date
  submissions: number;
  interviews: number;
  offers: number;
}

export interface Cohort {
  week: string; // label, e.g. "Apr 7"
  size: number;
  cells: (number | null)[]; // % advanced, W+0..W+7; null = no data
}

export interface DonutDatum {
  label: string;
  value: number;
  color: string; // a CSS color (token var() or literal)
}

/** [label, value, rightLabel?] */
export type BarRow = [string, number, string?];

// --- Per-tab payloads --------------------------------------------------------

export interface ReportTableColumn {
  key: string;
  header: string;
  align?: 'left' | 'right';
  mono?: boolean;
}

export interface PipelinePayload {
  kpis: Kpi[];
  charts: { funnel: FunnelStage[]; series: AreaPoint[]; cohorts: Cohort[] };
}
export interface RecruitersPayload {
  kpis: Kpi[];
  table: Record<string, unknown>[];
}
export interface ConsultantsPayload {
  kpis: Kpi[];
  charts: { visaMix: DonutDatum[]; statusMix: DonutDatum[] };
}
export interface PlacementsPayload {
  kpis: Kpi[];
  charts: { byClient: BarRow[] };
}
export interface SourcesPayload {
  kpis: Kpi[];
  table: Record<string, unknown>[];
}
export interface AIUsagePayload {
  kpis: Kpi[];
  charts: { series: AreaPoint[]; tokenSpend: BarRow[] };
}

export interface ReportPayloadMap {
  pipeline: PipelinePayload;
  recruiters: RecruitersPayload;
  consultants: ConsultantsPayload;
  placements: PlacementsPayload;
  sources: SourcesPayload;
  ai: AIUsagePayload;
}
