// Heuristic that decides whether a consultant needs the recruiter's attention
// today, and why. Used by the dashboard NeedsAttentionStrip. A "basic" version:
// it scores from the signals we can compute today (SCREENING age, bench
// staleness) and is pre-wired for richer signals (interviews/offers/DMs) the
// moment the backend provides them via DashboardCtx.

import type { DashConsultant, DashApplication } from '../components/dashboard/types';

export type UrgencyTone = 'urgent' | 'warning' | 'info';

export interface Urgency {
  tone: UrgencyTone;
  headline: string;
  detail: string;
  action: { label: string; route: string };
}

export interface DashboardCtx {
  /** Applications grouped by consultant id. */
  appsByConsultant: Map<string, DashApplication[]>;
  /** Unix ms "now"; injectable for tests. Defaults to Date.now(). */
  now?: number;
  /** Optional richer signals — wired when the backend serves them. */
  interviewsByConsultant?: Map<
    string,
    {
      starts_at: string;
      type?: string | null;
      company?: string | null;
      interviewers?: string | null;
    }[]
  >;
  offersByConsultant?: Map<
    string,
    { expires_at?: string | null; company?: string | null; comp?: string | null }[]
  >;
  unreadByConsultant?: Map<string, { topic?: string | null; last_message_at: string }>;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function name(c: DashConsultant): string {
  return c.user?.full_name ?? c.user?.email ?? 'Consultant';
}

/** "2h 12m", "45m", "3d" — compact countdown/relative span from ms. */
function span(ms: number): string {
  const abs = Math.abs(ms);
  if (abs < HOUR) return `${Math.max(1, Math.round(abs / 60000))}m`;
  if (abs < DAY) {
    const h = Math.floor(abs / HOUR);
    const m = Math.round((abs % HOUR) / 60000);
    return m ? `${h}h ${m}m` : `${h}h`;
  }
  return `${Math.round(abs / DAY)}d`;
}

/**
 * Returns the single highest-priority reason a consultant needs attention, or
 * null if nothing is pressing. Priority order matches the spec.
 */
export function scoreConsultant(c: DashConsultant, ctx: DashboardCtx): Urgency | null {
  const now = ctx.now ?? Date.now();
  const apps = ctx.appsByConsultant.get(c.id) ?? [];

  // 1. Interview within 4h → urgent
  const nextIv = (ctx.interviewsByConsultant?.get(c.id) ?? [])
    .map((iv) => ({ ...iv, t: new Date(iv.starts_at).getTime() }))
    .filter((iv) => iv.t > now && iv.t - now <= 4 * HOUR)
    .sort((a, b) => a.t - b.t)[0];
  if (nextIv) {
    const who = nextIv.interviewers ? ` w/ ${nextIv.interviewers}` : '';
    return {
      tone: 'urgent',
      headline: `Interview in ${span(nextIv.t - now)}`,
      detail:
        [nextIv.company, nextIv.type].filter(Boolean).join(' · ') + who || 'Upcoming interview',
      action: { label: 'Prep', route: '/interviews' },
    };
  }

  // 2. Offer expiring within 36h → urgent
  const offer = (ctx.offersByConsultant?.get(c.id) ?? [])
    .map((o) => ({ ...o, t: o.expires_at ? new Date(o.expires_at).getTime() : NaN }))
    .filter((o) => !Number.isNaN(o.t) && o.t > now && o.t - now <= 36 * HOUR)
    .sort((a, b) => a.t - b.t)[0];
  if (offer) {
    const when = new Date(offer.t);
    const tomorrow = new Date(now + DAY).toDateString() === when.toDateString();
    const label = tomorrow
      ? `Offer expires tomorrow ${when.toLocaleTimeString([], { hour: 'numeric' })}`
      : `Offer expires in ${span(offer.t - now)}`;
    return {
      tone: 'urgent',
      headline: label,
      detail: [offer.company, offer.comp].filter(Boolean).join(' · ') || 'Offer on the table',
      action: { label: 'Review offer', route: '/applications?status=OFFER' },
    };
  }

  // 3. SCREENING > 5 days → warning
  const screening = apps
    .filter((a) => a.status === 'SCREENING')
    .map((a) => ({
      a,
      since: new Date(a.submitted_at ?? a.updated_at ?? a.created_at ?? now).getTime(),
    }))
    .filter((x) => now - x.since > 5 * DAY)
    .sort((x, y) => x.since - y.since)[0];
  if (screening) {
    const days = Math.round((now - screening.since) / DAY);
    const match =
      typeof screening.a.match_score === 'number'
        ? `${Math.round(screening.a.match_score)}% match · `
        : '';
    return {
      tone: 'warning',
      headline: 'Awaiting submission',
      detail: `${screening.a.job?.title ?? 'Role'} · ${match}open ${days} days`,
      action: { label: 'Follow up', route: '/applications?status=SCREENING' },
    };
  }

  // 4. Unread DM > 5h → info
  const dm = ctx.unreadByConsultant?.get(c.id);
  if (dm) {
    const ago = now - new Date(dm.last_message_at).getTime();
    if (ago > 5 * HOUR) {
      return {
        tone: 'info',
        headline: 'Reply pending',
        detail: `${dm.topic ?? 'Message'} · ${span(ago)} ago`,
        action: { label: 'Reply', route: '/messages' },
      };
    }
  }

  // 5. Bench (active), not touched in 14d → info
  const status = (c.marketing_status ?? '').toUpperCase();
  const lastTouch = c.updated_at ? new Date(c.updated_at).getTime() : null;
  if (status === 'ACTIVE' && apps.length === 0 && lastTouch && now - lastTouch > 14 * DAY) {
    return {
      tone: 'info',
      headline: 'Bench refresh due',
      detail: `Last touch ${new Date(lastTouch).toLocaleDateString()}`,
      action: { label: 'Find roles', route: '/jobs' },
    };
  }

  return null;
}

/** Sort weight so urgent floats above warning above info. */
export const TONE_RANK: Record<UrgencyTone, number> = { urgent: 0, warning: 1, info: 2 };

export { name as consultantName };
