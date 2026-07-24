import { APPLIED_SUB_TABS } from './types';
import type { AppliedSubTab, JobRow, TabKey } from './types';

export function daysAgoISO(d: number): string {
  return new Date(Date.now() - d * 24 * 3600 * 1000).toISOString();
}

export function relative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d} day${d === 1 ? '' : 's'} ago`;
  return new Date(iso).toLocaleDateString();
}

export function isEarly(iso: string): boolean {
  return Date.now() - new Date(iso).getTime() < 24 * 3600 * 1000;
}

export function prettyType(t?: string | null): string {
  if (!t) return 'Full-time';
  const map: Record<string, string> = {
    W2: 'W2',
    C2C: 'C2C',
    FTE: 'Full-time',
    '1099': '1099',
  };
  return map[t] ?? t;
}

export function prettyRate(min?: number | null, max?: number | null): string {
  if (min == null && max == null) return 'Rate undisclosed';
  if (min != null && max != null) return `$${min}/hr – $${max}/hr`;
  return `$${min ?? max}/hr`;
}

export function scoreLabel(score: number | null): string {
  if (score == null) return 'No match yet';
  if (score >= 90) return 'Strong match';
  if (score >= 75) return 'Good match';
  if (score >= 50) return 'Fair match';
  return 'Weak match';
}

// Final apply-URL safety net: even if the server somehow stored an empty
// string, we'll synthesize a Google-for-jobs search so the button is usable.
export function resolveApplyUrl(job: JobRow): string {
  const u = (job.apply_url ?? '').trim();
  if (u && /^https?:\/\//i.test(u)) return u;
  const company = job.company_name ?? job.client?.company_name ?? '';
  return (
    'https://www.google.com/search?ibp=htl;jobs&q=' + encodeURIComponent(`${job.title} ${company}`)
  );
}

export function filteredRows(
  rows: JobRow[],
  tab: TabKey,
  sourceFilter: string,
  sub: AppliedSubTab,
): JobRow[] {
  let out = rows;
  if (sourceFilter) out = out.filter((j) => j.source === sourceFilter);
  if (tab === 'applied') {
    const def = APPLIED_SUB_TABS.find((t) => t.key === sub)!;
    out = out.filter((j) =>
      (def.statuses as string[]).includes(j.application_status ?? 'SUBMITTED'),
    );
  }
  return out;
}
