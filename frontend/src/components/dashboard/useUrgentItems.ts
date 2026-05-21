// TODO: wire to backend (GET /interviews/today?within=4h, offers, unread messages)
import { createElement } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { DashApplication, DashConsultant } from './types';

export interface UrgentItem {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  body: ReactNode;
  action: { label: string; onClick: () => void };
}

const MAX_ITEMS = 6;
const SCREENING_STALE_MS = 7 * 24 * 3_600_000;

/** Resolve the display name for a consultant from the consultants list or from
 *  the embedded `consultant` field on the application row. Falls back to
 *  'A consultant' if nothing is available. */
function resolveName(app: DashApplication, consultantsById: Map<string, DashConsultant>): string {
  // Prefer the embedded join field (richer, already fetched)
  const embeddedName = app.consultant?.user?.full_name;
  if (embeddedName) return embeddedName;

  // Fall back to looking up by consultant_id in the passed list
  const id = app.consultant_id ?? app.consultant?.id;
  if (id) {
    const c = consultantsById.get(id);
    const name = c?.user?.full_name;
    if (name) return name;
  }

  return 'A consultant';
}

export function useUrgentItems(
  consultants: DashConsultant[],
  apps: DashApplication[],
): UrgentItem[] {
  const navigate = useNavigate();

  const consultantsById = new Map<string, DashConsultant>(consultants.map((c) => [c.id, c]));

  const items: UrgentItem[] = [];

  // --- Critical: open offers ---
  const offerApps = apps.filter((a) => a.status === 'OFFER');
  for (const app of offerApps) {
    if (items.length >= MAX_ITEMS) break;
    const name = resolveName(app, consultantsById);
    items.push({
      id: `offer-${app.id}`,
      severity: 'critical',
      // <span><strong>{name}</strong> has an open offer — confirm next steps</span>
      body: createElement(
        'span',
        null,
        createElement('strong', null, name),
        ' has an open offer — confirm next steps',
      ),
      action: {
        label: 'Review',
        onClick: () => navigate('/applications?status=OFFER'),
      },
    });
  }

  // --- Warning: submissions stuck in SCREENING > 7 days ---
  const now = Date.now();
  const staleScreening = apps.filter((a) => {
    if (a.status !== 'SCREENING') return false;
    const ts = a.updated_at ?? a.submitted_at ?? a.created_at;
    if (!ts) return false;
    const age = now - new Date(ts).getTime();
    return Number.isFinite(age) && age > SCREENING_STALE_MS;
  });

  if (staleScreening.length > 0 && items.length < MAX_ITEMS) {
    const n = staleScreening.length;
    items.push({
      id: 'screening-stale',
      severity: 'warning',
      // <span><strong>{n} submission(s)</strong> stuck in screening &gt; 7 days</span>
      body: createElement(
        'span',
        null,
        createElement('strong', null, `${n} submission${n === 1 ? '' : 's'}`),
        ' stuck in screening > 7 days',
      ),
      action: {
        label: 'Review',
        onClick: () => navigate('/applications?status=SCREENING'),
      },
    });
  }

  // No info items derivable from current data yet.

  return items.slice(0, MAX_ITEMS);
}
