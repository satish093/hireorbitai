import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ButtonGroup, ButtonGroupItem } from '../ButtonGroup';
import { Avatar } from '../TaskBits';
import { api } from '../../services/api';
import type { ActivityEvent } from './types';

// ---------------------------------------------------------------------------
// Scope persistence
// ---------------------------------------------------------------------------

type Scope = 'mine' | 'team';
const SCOPE_KEY = 'ho-activity-scope';

function readScope(): Scope {
  try {
    const v = localStorage.getItem(SCOPE_KEY);
    if (v === 'team') return 'team';
  } catch {
    // storage blocked — fall through
  }
  return 'mine';
}

function writeScope(s: Scope): void {
  try {
    localStorage.setItem(SCOPE_KEY, s);
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Relative time helper
// ---------------------------------------------------------------------------

function timeAgo(ts: string): string {
  const delta = Date.now() - new Date(ts).getTime();
  if (isNaN(delta) || delta < 0) return '—';
  const sec = Math.floor(delta / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d`;
  const wk = Math.floor(day / 7);
  if (wk < 8) return `${wk}w`;
  const mo = Math.floor(day / 30);
  return `${mo}mo`;
}

// ---------------------------------------------------------------------------
// Tone → class maps (chip background + text)
// ---------------------------------------------------------------------------

const CHIP_CLASSES: Record<ActivityEvent['tone'], string> = {
  success: 'bg-success-soft text-success',
  danger: 'bg-danger-soft text-danger',
  warning: 'bg-warn-soft text-warn',
  accent: 'bg-accent-soft text-accent',
  neutral: 'bg-bg-sunken text-muted',
};

// ---------------------------------------------------------------------------
// Inline SVG icons  (14×14 inside a 24×24 chip)
// ---------------------------------------------------------------------------

function ActivityIcon({ icon }: { icon: ActivityEvent['icon'] }) {
  const shared = {
    width: 14,
    height: 14,
    viewBox: '0 0 24 24',
    fill: 'none' as const,
    stroke: 'currentColor',
    strokeWidth: 1.75,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  switch (icon) {
    case 'send':
      return (
        <svg {...shared} aria-hidden="true">
          <path d="M22 2 11 13" />
          <path d="M22 2 15 22 11 13 2 9l20-7z" />
        </svg>
      );
    case 'star':
      return (
        <svg {...shared} aria-hidden="true">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      );
    case 'sparkles':
      return (
        <svg {...shared} aria-hidden="true">
          <path d="M12 3v2M12 19v2M3 12H1M23 12h-2M5.6 5.6 4.2 4.2M19.8 19.8l-1.4-1.4M5.6 18.4l-1.4 1.4M19.8 4.2l-1.4 1.4" />
          <circle cx="12" cy="12" r="4" />
        </svg>
      );
    case 'inbox':
      return (
        <svg {...shared} aria-hidden="true">
          <path d="M22 12h-6l-2 3h-4l-2-3H2" />
          <path d="M5.5 5h13l3 7v6a2 2 0 0 1-2 2H4.5a2 2 0 0 1-2-2v-6z" />
        </svg>
      );
    case 'trash':
      return (
        <svg {...shared} aria-hidden="true">
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
          <path d="M10 11v6M14 11v6" />
          <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
        </svg>
      );
    case 'doc':
      return (
        <svg {...shared} aria-hidden="true">
          <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
          <path d="M14 3v6h6M8 13h8M8 17h6" />
        </svg>
      );
    case 'video':
      return (
        <svg {...shared} aria-hidden="true">
          <rect x="2" y="5" width="14" height="14" rx="2" />
          <path d="M16 9l6-3v12l-6-3V9z" />
        </svg>
      );
    case 'download':
      return (
        <svg {...shared} aria-hidden="true">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
      );
  }
}

// ---------------------------------------------------------------------------
// Client-side feed builder (fallback when /activity 404s)
// ---------------------------------------------------------------------------

/** Minimal shapes we need from the API responses. */
interface RawApp {
  id?: string;
  status?: string | null;
  submitted_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  job?: { id?: string; title?: string | null } | null;
  consultant?: {
    id?: string;
    user?: { full_name?: string | null; email?: string | null } | null;
  } | null;
}

interface RawTask {
  id?: string;
  title?: string;
  updated_at?: string | null;
  created_at?: string | null;
}

function appToEvent(app: RawApp): ActivityEvent | null {
  if (!app.id) return null;

  const ts = app.updated_at ?? app.submitted_at ?? app.created_at ?? '';
  if (!ts) return null;

  const status = (app.status ?? '').toUpperCase();
  const consultantName =
    app.consultant?.user?.full_name ?? app.consultant?.user?.email ?? undefined;

  let verb: ActivityEvent['verb'] = 'submitted';
  let tone: ActivityEvent['tone'] = 'accent';
  let icon: ActivityEvent['icon'] = 'send';

  if (status === 'REJECTED' || status === 'WITHDRAWN' || status === 'ARCHIVED') {
    verb = 'archived';
    tone = 'danger';
    icon = 'trash';
  } else if (status === 'OFFER' || status === 'PLACED' || status === 'ACCEPTED') {
    verb = 'received';
    tone = 'success';
    icon = 'inbox';
  } else if (status === 'INTERVIEW' || status === 'SCREENING') {
    verb = 'reached';
    tone = 'warning';
    icon = 'video';
  }

  const actor: ActivityEvent['actor'] = consultantName ? { name: consultantName } : 'system';

  return {
    id: `app-${app.id}`,
    ts,
    actor,
    verb,
    object: { label: app.job?.title ?? 'a role' },
    context: consultantName ? { label: consultantName } : undefined,
    tone,
    icon,
  };
}

function taskToEvent(task: RawTask): ActivityEvent | null {
  if (!task.id || !task.title) return null;
  const ts = task.updated_at ?? task.created_at ?? '';
  if (!ts) return null;

  return {
    id: `task-${task.id}`,
    ts,
    actor: 'system',
    verb: 'updated',
    object: { label: task.title },
    tone: 'neutral',
    icon: 'doc',
  };
}

async function buildClientSideFeed(): Promise<ActivityEvent[]> {
  const [appEvents, taskEvents] = await Promise.all([
    api
      .get<RawApp[]>('/applications', { params: { limit: 20 } })
      .then((r) => (Array.isArray(r.data) ? r.data : []).flatMap((a) => appToEvent(a) ?? []))
      .catch(() => [] as ActivityEvent[]),

    api
      .get<RawTask[]>('/tasks/assigned-to-me')
      .then((r) => (Array.isArray(r.data) ? r.data : []).flatMap((t) => taskToEvent(t) ?? []))
      .catch(() => [] as ActivityEvent[]),
  ]);

  const merged = [...appEvents, ...taskEvents];
  merged.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
  return merged.slice(0, 50);
}

// ---------------------------------------------------------------------------
// Single event row
// ---------------------------------------------------------------------------

function EventRow({
  event,
  navigate,
}: {
  event: ActivityEvent;
  navigate: ReturnType<typeof useNavigate>;
}) {
  const actorName = event.actor === 'system' ? 'System' : event.actor.name;
  const actorEmail = event.actor === 'system' ? undefined : undefined;

  return (
    <div className="flex items-start gap-3 px-4 py-2.5">
      {/* Left: tinted icon chip */}
      <div
        className={`w-6 h-6 rounded-md grid place-items-center shrink-0 ${CHIP_CLASSES[event.tone]}`}
        aria-hidden="true"
      >
        <ActivityIcon icon={event.icon} />
      </div>

      {/* Middle: narrative text */}
      <p className="flex-1 text-[13px] text-ink-2 leading-snug min-w-0">
        {event.actor !== 'system' && <Avatar name={actorName} email={actorEmail} size={16} />}{' '}
        <strong className="text-ink font-medium">{actorName}</strong> {event.verb}{' '}
        {event.object.href ? (
          <strong
            className="text-ink font-medium cursor-pointer hover:underline"
            onClick={() => event.object.href && navigate(event.object.href)}
          >
            {event.object.label}
          </strong>
        ) : (
          <strong className="text-ink font-medium">{event.object.label}</strong>
        )}
        {event.context ? (
          <>
            {' · '}
            {event.context.href ? (
              <span
                className="cursor-pointer hover:underline text-ink-2"
                onClick={() => event.context?.href && navigate(event.context.href)}
              >
                {event.context.label}
              </span>
            ) : (
              <span className="text-ink-2">{event.context.label}</span>
            )}
          </>
        ) : null}
      </p>

      {/* Right: relative time */}
      <span className="text-[11px] font-mono text-faint shrink-0 pt-px">{timeAgo(event.ts)}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeleton rows
// ---------------------------------------------------------------------------

function SkeletonRows() {
  return (
    <>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-9 animate-pulse bg-bg-sunken rounded mx-4 my-2" />
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function ActivityStream(): JSX.Element {
  const navigate = useNavigate();
  const [scope, setScope] = useState<Scope>(readScope);
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const cancelRef = useRef(false);

  function handleScope(s: Scope) {
    setScope(s);
    writeScope(s);
  }

  useEffect(() => {
    cancelRef.current = false;
    setLoading(true);
    setEvents([]);

    (async () => {
      let feed: ActivityEvent[] = [];

      try {
        const res = await api.get<ActivityEvent[]>('/activity', {
          params: { scope, limit: 50 },
        });
        if (Array.isArray(res.data)) {
          feed = res.data;
        } else {
          feed = await buildClientSideFeed();
        }
      } catch (err: unknown) {
        // 404 or any network failure → fall back to client-side merge
        const status = (err as { response?: { status?: number } })?.response?.status;
        if (!status || status === 404 || status >= 500) {
          feed = await buildClientSideFeed();
        }
        // 401/403 → leave feed empty, auth handler will redirect
      }

      if (!cancelRef.current) {
        setEvents(feed);
        setLoading(false);
      }
    })();

    return () => {
      cancelRef.current = true;
    };
  }, [scope]);

  return (
    <section className="rounded-xl border border-border bg-surface">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink">Activity</h2>
        <ButtonGroup>
          <ButtonGroupItem pressed={scope === 'mine'} onClick={() => handleScope('mine')}>
            Mine
          </ButtonGroupItem>
          <ButtonGroupItem pressed={scope === 'team'} onClick={() => handleScope('team')}>
            Team
          </ButtonGroupItem>
        </ButtonGroup>
      </div>

      {/* Body */}
      <div className="max-h-[380px] overflow-y-auto divide-y divide-border">
        {loading ? (
          <SkeletonRows />
        ) : events.length === 0 ? (
          /* Empty state — card + header remain visible */
          <div className="py-10 text-center px-6">
            <p className="text-sm font-medium text-muted">No recent activity</p>
            <p className="text-xs text-faint mt-1">
              Submissions, scores, and messages will show up here.
            </p>
          </div>
        ) : (
          events.map((ev) => <EventRow key={ev.id} event={ev} navigate={navigate} />)
        )}
      </div>
    </section>
  );
}
