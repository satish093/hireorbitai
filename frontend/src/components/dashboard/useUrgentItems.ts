import { createElement, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate, type NavigateFunction } from 'react-router-dom';
import { api } from '../../services/api';
import type { DashApplication, DashConsultant } from './types';

export interface UrgentItem {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  body: ReactNode;
  action: { label: string; onClick: () => void };
}

const MAX_ITEMS = 6;
const SCREENING_STALE_MS = 7 * 24 * 3_600_000;

// Server payload from GET /activity/urgent.
interface UrgentFeed {
  interviews: {
    id: string;
    consultantName: string | null;
    type: string | null;
    scheduled_at: string;
  }[];
  offersExpiring: {
    id: string;
    consultantName: string | null;
    jobTitle: string | null;
    expires_at: string | null;
  }[];
  screeningStuck: number;
  unreadDms?: number;
}

/** Compact "in 2h 10m" / "in 45m" / "today 5pm" for a near-future timestamp. */
function whenSoon(iso: string | null): string {
  if (!iso) return 'soon';
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms)) return 'soon';
  if (ms <= 0) return 'now';
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `in ${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `in ${h}h ${m}m` : `in ${h}h`;
}

function strongLine(name: string, rest: string): ReactNode {
  return createElement('span', null, createElement('strong', null, name), rest);
}

/** Shape the server urgent feed into ribbon items. */
function buildServerItems(feed: UrgentFeed, navigate: NavigateFunction): UrgentItem[] {
  const items: UrgentItem[] = [];
  for (const iv of feed.interviews ?? []) {
    items.push({
      id: `iv-${iv.id}`,
      severity: 'critical',
      body: strongLine(
        iv.consultantName ?? 'A consultant',
        ` has an interview ${whenSoon(iv.scheduled_at)}${iv.type ? ` · ${iv.type}` : ''}`,
      ),
      action: { label: 'Prep', onClick: () => navigate('/interviews') },
    });
  }
  for (const o of feed.offersExpiring ?? []) {
    items.push({
      id: `offer-${o.id}`,
      severity: 'critical',
      body: strongLine(
        o.consultantName ?? 'A consultant',
        `'s offer expires ${whenSoon(o.expires_at)}${o.jobTitle ? ` · ${o.jobTitle}` : ''}`,
      ),
      action: { label: 'Review offer', onClick: () => navigate('/applications?status=OFFER') },
    });
  }
  if (feed.screeningStuck > 0) {
    const n = feed.screeningStuck;
    items.push({
      id: 'screening-stale',
      severity: 'warning',
      body: strongLine(`${n} submission${n === 1 ? '' : 's'}`, ' stuck in screening > 7 days'),
      action: { label: 'Review', onClick: () => navigate('/applications?status=SCREENING') },
    });
  }
  if (feed.unreadDms && feed.unreadDms > 0) {
    const n = feed.unreadDms;
    items.push({
      id: 'unread-dms',
      severity: 'info',
      body: strongLine(`${n} unread message${n === 1 ? '' : 's'}`, ' from consultants > 24h old'),
      action: { label: 'Open inbox', onClick: () => navigate('/messages') },
    });
  }
  return items.slice(0, MAX_ITEMS);
}

function resolveName(app: DashApplication, consultantsById: Map<string, DashConsultant>): string {
  const embeddedName = app.consultant?.user?.full_name;
  if (embeddedName) return embeddedName;
  const id = app.consultant_id ?? app.consultant?.id;
  if (id) {
    const name = consultantsById.get(id)?.user?.full_name;
    if (name) return name;
  }
  return 'A consultant';
}

/** Client-side fallback derived from already-loaded data (used when the
 *  /activity/urgent endpoint is unavailable). */
function buildClientItems(
  consultants: DashConsultant[],
  apps: DashApplication[],
  navigate: NavigateFunction,
): UrgentItem[] {
  const byId = new Map<string, DashConsultant>(consultants.map((c) => [c.id, c]));
  const items: UrgentItem[] = [];
  for (const app of apps.filter((a) => a.status === 'OFFER')) {
    if (items.length >= MAX_ITEMS) break;
    items.push({
      id: `offer-${app.id}`,
      severity: 'critical',
      body: strongLine(resolveName(app, byId), ' has an open offer — confirm next steps'),
      action: { label: 'Review', onClick: () => navigate('/applications?status=OFFER') },
    });
  }
  const now = Date.now();
  const stale = apps.filter((a) => {
    if (a.status !== 'SCREENING') return false;
    const ts = a.updated_at ?? a.submitted_at ?? a.created_at;
    if (!ts) return false;
    const age = now - new Date(ts).getTime();
    return Number.isFinite(age) && age > SCREENING_STALE_MS;
  });
  if (stale.length > 0 && items.length < MAX_ITEMS) {
    const n = stale.length;
    items.push({
      id: 'screening-stale',
      severity: 'warning',
      body: strongLine(`${n} submission${n === 1 ? '' : 's'}`, ' stuck in screening > 7 days'),
      action: { label: 'Review', onClick: () => navigate('/applications?status=SCREENING') },
    });
  }
  return items.slice(0, MAX_ITEMS);
}

/**
 * Time-critical alerts for the dashboard ribbon. Prefers the server feed
 * (GET /activity/urgent — interviews within 4h, offers expiring, screening
 * stuck); falls back to client-derived items from already-loaded data when the
 * endpoint isn't available.
 */
export function useUrgentItems(
  consultants: DashConsultant[],
  apps: DashApplication[],
): UrgentItem[] {
  const navigate = useNavigate();
  const [server, setServer] = useState<UrgentItem[] | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .get<UrgentFeed>('/activity/urgent')
      .then((r) => {
        if (alive && r.data && typeof r.data === 'object') {
          setServer(buildServerItems(r.data, navigate));
        }
      })
      .catch(() => {
        /* keep null → client fallback */
      });
    return () => {
      alive = false;
    };
    // navigate is stable; fetch once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return server ?? buildClientItems(consultants, apps, navigate);
}
