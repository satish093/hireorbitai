import { useState, useEffect, useCallback } from 'react';
import { Layout } from '../components/Layout';
import { api } from '../services/api';

interface AuditEvent {
  id: string;
  action: string;
  user_id: string | null;
  email: string | null;
  ip_address: string | null;
  user_agent: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

const ACTION_GROUPS: Record<string, string[]> = {
  Auth: [
    'login_success',
    'login_failed',
    'login_blocked_locked',
    'logout',
    'password_changed',
    'password_reset_requested',
    'password_reset_completed',
    'password_reset_invalid_token',
    'must_change_password_enforced',
    'account_locked',
    'account_unlocked',
  ],
  'Admin — Users': [
    'admin_created_user',
    'admin_disabled_user',
    'admin_role_changed',
    'admin_user_status_changed',
    'admin_user_password_reset',
    'admin_user_deactivated',
    'admin_user_reactivated',
    'admin_user_deleted',
    'admin_user_impersonated',
    'admin_session_revoked',
    'admin_sessions_revoked_all',
    'admin_user_force_password_change',
    'admin_users_bulk_action',
  ],
  'Admin — Groups': [
    'group_created',
    'group_updated',
    'group_deleted',
    'group_user_assigned',
    'group_user_removed',
    'group_user_moved',
  ],
  Resumes: ['resume_uploaded', 'resume_downloaded', 'resume_deleted', 'resume_access_denied'],
  Training: ['training_course_accessed', 'training_lesson_accessed'],
  Documents: ['work_auth_doc_uploaded', 'work_auth_doc_deleted'],
  Other: [
    'messages_permission_denied',
    'data_access_denied',
    'daily_digest_sent',
    'daily_digest_skipped',
  ],
};

function actionTone(action: string): string {
  if (/failed|denied|blocked|locked|deleted|deactivated|invalid|disabled/.test(action))
    return 'text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-500/10';
  if (/role_changed|bulk|impersonated|suspended/.test(action))
    return 'text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10';
  if (/created|reactivated|unlocked|reset_completed/.test(action))
    return 'text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10';
  return 'text-sky-700 dark:text-sky-400 bg-sky-50 dark:bg-sky-500/10';
}

/** Returns the CSS color of the severity dot for a given action. */
function severityDot(action: string): string {
  if (/failed|denied|blocked|locked|deleted|deactivated|invalid|disabled/.test(action))
    return 'var(--danger)';
  if (/role_changed|bulk|impersonated|suspended/.test(action)) return 'var(--warn)';
  if (/created|reactivated|unlocked|reset_completed/.test(action)) return 'var(--success)';
  return 'var(--accent)';
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

const PAGE_SIZE = 50;

export function AdminAuditLog() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  // Filters
  const [filterAction, setFilterAction] = useState('');
  const [filterEmail, setFilterEmail] = useState('');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const fetchPage = useCallback(
    async (off: number, replace: boolean) => {
      setLoading(true);
      try {
        const params: Record<string, string> = {
          limit: String(PAGE_SIZE),
          offset: String(off),
        };
        if (filterAction) params.action = filterAction;
        if (filterEmail) params.email = filterEmail;
        if (filterFrom) params.from = new Date(filterFrom).toISOString();
        if (filterTo) params.to = new Date(filterTo + 'T23:59:59').toISOString();

        const { data } = await api.get<AuditEvent[]>('/admin/users/audit', { params });
        const rows = data ?? [];
        setEvents((prev) => (replace ? rows : [...prev, ...rows]));
        setHasMore(rows.length === PAGE_SIZE);
        setOffset(off + rows.length);
      } finally {
        setLoading(false);
      }
    },
    [filterAction, filterEmail, filterFrom, filterTo],
  );

  useEffect(() => {
    setOffset(0);
    fetchPage(0, true);
  }, [fetchPage]);

  function applyFilters(e: React.FormEvent) {
    e.preventDefault();
    setOffset(0);
    fetchPage(0, true);
  }

  function clearFilters() {
    setFilterAction('');
    setFilterEmail('');
    setFilterFrom('');
    setFilterTo('');
  }

  /** Export the currently-loaded events as a CSV download (client-side). */
  function exportCsv() {
    if (events.length === 0) return;
    const headers = ['Time', 'Action', 'Email', 'User ID', 'IP address', 'User agent', 'Metadata'];
    const esc = (v: unknown) => {
      let s = v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v);
      // Neutralize spreadsheet formula injection: a cell starting with = + - @
      // (or tab/CR) executes as a formula in Excel/Sheets even inside a quoted
      // field. user_agent / email / metadata are attacker-controllable.
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
      return `"${s.replace(/"/g, '""')}"`;
    };
    const lines = events.map((ev) =>
      [
        fmtDate(ev.created_at),
        ev.action,
        ev.email ?? '',
        ev.user_id ?? '',
        ev.ip_address ?? '',
        ev.user_agent ?? '',
        ev.metadata ?? '',
      ]
        .map(esc)
        .join(','),
    );
    const csv = [headers.map(esc).join(','), ...lines].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Layout
      title="Audit Log"
      crumbs={[
        { label: 'Workspace', to: '/dashboard' },
        { label: 'Admin', to: '/admin/users' },
        { label: 'Audit Log' },
      ]}
    >
      <div className="max-w-6xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Audit Log</h1>
            <p className="text-sm text-muted mt-0.5">
              All security and data-access events across the platform.
            </p>
          </div>
          <button
            type="button"
            onClick={exportCsv}
            disabled={events.length === 0}
            className="shrink-0 text-sm font-medium px-4 py-1.5 rounded-md border border-border hover:border-accent/40 hover:text-ink text-muted transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Export CSV ({events.length})
          </button>
        </div>

        {/* Filters */}
        <form
          onSubmit={applyFilters}
          className="bg-surface border border-border rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3"
        >
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-widest text-muted mb-1">
              Action
            </label>
            <select
              value={filterAction}
              onChange={(e) => setFilterAction(e.target.value)}
              className="w-full text-sm border border-border rounded-md px-2 py-1.5 bg-surface focus:outline-none focus:ring-2 focus:ring-brand-500/40"
            >
              <option value="">All actions</option>
              {Object.entries(ACTION_GROUPS).map(([group, actions]) => (
                <optgroup key={group} label={group}>
                  {actions.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-widest text-muted mb-1">
              Email
            </label>
            <input
              type="email"
              value={filterEmail}
              onChange={(e) => setFilterEmail(e.target.value)}
              placeholder="user@example.com"
              className="w-full text-sm border border-border rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
            />
          </div>
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-widest text-muted mb-1">
              From date
            </label>
            <input
              type="date"
              value={filterFrom}
              onChange={(e) => setFilterFrom(e.target.value)}
              className="w-full text-sm border border-border rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
            />
          </div>
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-widest text-muted mb-1">
              To date
            </label>
            <input
              type="date"
              value={filterTo}
              onChange={(e) => setFilterTo(e.target.value)}
              className="w-full text-sm border border-border rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
            />
          </div>
          <div className="lg:col-span-4 flex gap-2 justify-end">
            <button
              type="button"
              onClick={clearFilters}
              className="text-sm text-muted hover:text-ink px-3 py-1.5 rounded-md border border-border hover:border-accent/40 transition"
            >
              Clear
            </button>
            <button
              type="submit"
              className="text-sm font-medium bg-accent text-white px-4 py-1.5 rounded-md hover:bg-accent/90 transition"
            >
              Apply filters
            </button>
          </div>
        </form>

        {/* Table */}
        <div className="bg-surface border border-border rounded-xl overflow-hidden">
          {loading && events.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-muted text-sm">Loading…</div>
          ) : events.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-muted text-sm">
              No events found.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {events.map((ev) => (
                <div key={ev.id} className="hover:bg-hover transition">
                  <button
                    className="w-full text-left px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4"
                    onClick={() => setExpanded(expanded === ev.id ? null : ev.id)}
                  >
                    {/* Severity dot — visible on all breakpoints for quick scanning */}
                    <span
                      className="shrink-0 w-2 h-2 rounded-full hidden sm:block"
                      style={{ background: severityDot(ev.action) }}
                      aria-hidden="true"
                    />
                    <span className="flex items-center gap-2 sm:contents">
                      {/* Mobile: dot inline with date */}
                      <span
                        className="w-2 h-2 rounded-full shrink-0 sm:hidden"
                        style={{ background: severityDot(ev.action) }}
                        aria-hidden="true"
                      />
                      <span className="shrink-0 text-xs text-muted sm:w-40">
                        {fmtDate(ev.created_at)}
                      </span>
                    </span>
                    <span
                      className={`shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-full ${actionTone(ev.action)}`}
                    >
                      {ev.action}
                    </span>
                    <span className="text-sm text-ink truncate min-w-0">
                      {ev.email ?? ev.user_id ?? '—'}
                    </span>
                    {ev.ip_address && (
                      <span className="text-xs text-muted ml-auto shrink-0">{ev.ip_address}</span>
                    )}
                  </button>

                  {expanded === ev.id && (
                    <div className="px-4 pb-3 pt-0 space-y-1.5 text-xs text-muted bg-hover/40">
                      {ev.user_id && (
                        <div>
                          <span className="font-medium text-ink">User ID: </span>
                          {ev.user_id}
                        </div>
                      )}
                      {ev.ip_address && (
                        <div>
                          <span className="font-medium text-ink">IP: </span>
                          {ev.ip_address}
                        </div>
                      )}
                      {ev.user_agent && (
                        <div>
                          <span className="font-medium text-ink">User-agent: </span>
                          <span className="break-all">{ev.user_agent}</span>
                        </div>
                      )}
                      {ev.metadata && Object.keys(ev.metadata).length > 0 && (
                        <div>
                          <span className="font-medium text-ink">Metadata: </span>
                          <pre className="inline whitespace-pre-wrap break-all">
                            {JSON.stringify(ev.metadata, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {hasMore && !loading && (
          <div className="flex justify-center">
            <button
              onClick={() => fetchPage(offset, false)}
              className="text-sm text-accent hover:underline px-4 py-2"
            >
              Load more
            </button>
          </div>
        )}
        {loading && events.length > 0 && (
          <div className="text-center text-sm text-muted py-2">Loading…</div>
        )}
      </div>
    </Layout>
  );
}
