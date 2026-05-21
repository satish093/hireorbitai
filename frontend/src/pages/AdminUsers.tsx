import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Layout } from '../components/Layout';
import { DataTable } from '../components/DataTable';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/Button';
import { FormInput } from '../components/FormInput';
import { SelectInput } from '../components/SelectInput';
import { Avatar } from '../components/TaskBits';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { invalidate, useInvalidationListener } from '../hooks/useInvalidate';
import { ALL_ROLES, Role, ROLE_LABEL } from '../types';
import clsx from 'clsx';

type Status = 'active' | 'inactive' | 'suspended' | 'pending_verification' | 'banned';

interface AdminUserRow {
  id: string;
  email: string;
  full_name: string | null;
  role: Role;
  status: Status | null;
  must_change_password: boolean;
  group_id: string | null;
  created_at: string;
  last_login_at: string | null;
  last_seen_at: string | null;
  status_reason: string | null;
}

interface GroupLite {
  id: string;
  name: string;
  color?: string | null;
  unique_group_id?: string | null;
}

interface ListResponse {
  rows: AdminUserRow[];
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
}

const STATUS_FILTERS: { value: Status | ''; label: string }[] = [
  { value: '', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'pending_verification', label: 'Pending verification' },
  { value: 'banned', label: 'Banned' },
];

const STATUS_PILL: Record<Status, string> = {
  active:
    'bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30',
  inactive: 'bg-muted  text-muted-foreground  border-border',
  suspended:
    'bg-amber-50 dark:bg-amber-500/15   text-amber-800 dark:text-amber-300  border-amber-200 dark:border-amber-500/30',
  pending_verification:
    'bg-sky-50 dark:bg-sky-500/15     text-sky-700 dark:text-sky-300    border-sky-200 dark:border-sky-500/30',
  banned:
    'bg-red-50 dark:bg-red-500/15     text-red-700 dark:text-red-300    border-red-200 dark:border-red-500/30',
};

const STATUS_DOT: Record<Status, string> = {
  active: 'bg-emerald-500',
  inactive: 'bg-muted-foreground',
  suspended: 'bg-amber-500',
  pending_verification: 'bg-sky-500',
  banned: 'bg-red-500',
};

/**
 * Admin "All Users" — server-side paginated, filterable list.
 *
 * Filters live in the URL (?role=…&status=…&q=…&page=…) so the page is
 * shareable and the back button works. The state-derived URL also means
 * a hard refresh keeps the user where they were.
 */
export function AdminUsers() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const role = (params.get('role') as Role | '') ?? '';
  const status = (params.get('status') as Status | '') ?? '';
  const sort = params.get('sort') ?? 'created_at';
  const order = (params.get('order') as 'asc' | 'desc') ?? 'desc';
  const page = Number(params.get('page') ?? 1);
  const page_size = Number(params.get('page_size') ?? 50);

  // Local search input — debounced into the URL so we don't fetch per keystroke.
  const [qInput, setQInput] = useState(q);
  useEffect(() => {
    setQInput(q);
  }, [q]);
  useEffect(() => {
    const t = setTimeout(() => {
      // Functional setSearchParams: reads the freshest URL state at fire
      // time. The previous implementation captured `params` in the closure
      // when the effect ran — if the user changed role/status/sort within
      // the 300ms window, the timer fired with a stale params reference
      // and silently clobbered those filters back to their old values.
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          // No-op if the URL already reflects the current input, so we don't
          // churn history during paste/undo of identical text.
          if ((next.get('q') ?? '') === qInput) return prev;
          if (qInput) next.set('q', qInput);
          else next.delete('q');
          next.set('page', '1');
          return next;
        },
        { replace: true },
      );
    }, 300);
    return () => clearTimeout(t);
  }, [qInput, setParams]);

  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyRowId, setBusyRowId] = useState<string | null>(null);
  // Groups lookup map — fetched once, used to render colored badges in the
  // Group column. Empty map (e.g. migration not applied) means we just show
  // "No Group" labels instead of crashing.
  const [groupsById, setGroupsById] = useState<Record<string, GroupLite>>({});
  useEffect(() => {
    api
      .get<GroupLite[]>('/user-groups')
      .then((r) => {
        const map: Record<string, GroupLite> = {};
        for (const g of r.data ?? []) map[g.id] = g;
        setGroupsById(map);
      })
      .catch(() => {
        /* non-fatal — badges will fall back to "No Group" */
      });
  }, []);
  // Bumped whenever a sibling page (or this one) invalidates the 'users'
  // channel — see useInvalidationListener below. Drops into the fetch
  // effect's deps so cross-page mutations refetch the list automatically.
  const [reloadTick, setReloadTick] = useState(0);
  const { profile: me } = useAuth();
  useInvalidationListener('users', () => setReloadTick((n) => n + 1));

  // Memoize the param string we send to the API so the effect only fires
  // when the relevant query changes.
  const queryString = useMemo(() => {
    const p: Record<string, string> = {
      page: String(page),
      page_size: String(page_size),
      sort,
      order,
    };
    if (q) p.q = q;
    if (role) p.role = role;
    if (status) p.status = status;
    return p;
  }, [q, role, status, sort, order, page, page_size]);

  useEffect(() => {
    const ctl = new AbortController();
    setLoading(true);
    api
      .get<ListResponse>('/admin/users', { params: queryString, signal: ctl.signal })
      .then((r) => setData(r.data))
      .catch((e) => {
        if (e?.code === 'ERR_CANCELED') return;
        toast.error(e?.response?.data?.error ?? 'Failed to load users');
      })
      .finally(() => {
        if (!ctl.signal.aborted) setLoading(false);
      });
    return () => ctl.abort();
  }, [queryString, reloadTick]);

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.set('page', '1');
    setParams(next, { replace: false });
  }

  // Quick lifecycle actions invoked from the row menu. We patch the local
  // row in place so the status pill flips immediately, without a full table
  // reload — feels much snappier on large lists.
  async function quickSetStatus(u: AdminUserRow, status: Status, reason?: string) {
    if (!data || busyRowId) return;
    if (me?.id === u.id && status !== 'active') {
      toast.error("You can't change your own status — ask another admin.");
      return;
    }
    setBusyRowId(u.id);
    try {
      const { data: updated } = await api.patch(`/admin/users/${u.id}/status`, {
        status,
        reason: reason || undefined,
      });
      setData({
        ...data,
        rows: data.rows.map((r) =>
          r.id === u.id
            ? {
                ...r,
                status: (updated.status ?? status) as Status,
                status_reason: updated.status_reason ?? null,
              }
            : r,
        ),
      });
      toast.success(
        status === 'active' ? `${u.email} reactivated` : `${u.email} ${status.replace(/_/g, ' ')}`,
      );
      // Tell sibling pages (detail view, deactivated accounts) that the
      // users dataset is dirty so they refetch when they next render.
      invalidate('users');
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Status change failed');
    } finally {
      setBusyRowId(null);
    }
  }

  async function quickSendReset(u: AdminUserRow) {
    if (busyRowId) return;
    if (!confirm(`Send a password reset email to ${u.email}?`)) return;
    setBusyRowId(u.id);
    try {
      await api.post(`/admin/users/${u.id}/send-password-reset`);
      toast.success('Password reset email sent');
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Send failed');
    } finally {
      setBusyRowId(null);
    }
  }

  const total = data?.total ?? 0;
  const totalPages = data?.total_pages ?? 0;

  return (
    <Layout title="Admin · Users">
      <PageHeader
        title="All users"
        description="Manage every account in the workspace. Filter by role, status, or search by name/email."
        action={
          <span className="text-sm text-muted-foreground">
            {loading ? 'Loading…' : `${total.toLocaleString()} ${total === 1 ? 'user' : 'users'}`}
          </span>
        }
      />

      {/* Filters */}
      <div className="bg-card border border-border rounded-xl p-3 mb-4 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[220px]">
          <FormInput
            label="Search"
            placeholder="Name or email"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
          />
        </div>
        <div className="w-44">
          <SelectInput
            label="Role"
            placeholder="All roles"
            value={role}
            onChange={(e) => setParam('role', e.target.value || null)}
            options={ALL_ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] }))}
          />
        </div>
        <div className="w-48">
          <SelectInput
            label="Status"
            value={status}
            onChange={(e) => setParam('status', e.target.value || null)}
            options={STATUS_FILTERS}
          />
        </div>
        <div className="w-44">
          <SelectInput
            label="Sort by"
            value={sort}
            onChange={(e) => setParam('sort', e.target.value)}
            options={[
              { value: 'created_at', label: 'Newest first' },
              { value: 'last_login_at', label: 'Recently active' },
              { value: 'email', label: 'Email A→Z' },
              { value: 'full_name', label: 'Name A→Z' },
            ]}
          />
        </div>
        {(q || role || status) && (
          <Button
            variant="ghost"
            onClick={() => setParams(new URLSearchParams(), { replace: false })}
          >
            Reset
          </Button>
        )}
      </div>

      <DataTable
        loading={loading}
        empty="No users match these filters."
        rows={data?.rows ?? []}
        columns={[
          {
            key: 'name',
            header: 'Name',
            render: (u: AdminUserRow) => (
              <Link
                to={`/admin/users/${u.id}`}
                className="inline-flex items-center gap-2 hover:bg-muted rounded -mx-1 px-1 py-0.5"
              >
                <Avatar name={u.full_name} email={u.email} size={28} />
                <div className="leading-tight">
                  <div className="text-sm font-medium text-foreground hover:underline">
                    {u.full_name ?? u.email}
                  </div>
                  <div className="text-[11px] text-muted-foreground">{u.email}</div>
                </div>
              </Link>
            ),
          },
          {
            key: 'role',
            header: 'Role',
            render: (u: AdminUserRow) => (
              <span className="text-[11px] font-medium bg-muted text-foreground px-1.5 py-0.5 rounded">
                {ROLE_LABEL[u.role] ?? u.role}
              </span>
            ),
          },
          {
            key: 'group',
            header: 'Group',
            render: (u: AdminUserRow) => {
              const g = u.group_id ? groupsById[u.group_id] : undefined;
              if (!g) {
                return <span className="text-[11px] text-muted-foreground italic">No Group</span>;
              }
              return (
                <span
                  className="inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded text-[11px] font-medium"
                  style={{
                    background: `${g.color ?? '#6366F1'}1A`, // 10% alpha
                    color: g.color ?? '#4F46E5',
                  }}
                  title={g.unique_group_id ?? undefined}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ background: g.color ?? '#6366F1' }}
                  />
                  {g.name}
                </span>
              );
            },
          },
          {
            key: 'status',
            header: 'Status',
            render: (u: AdminUserRow) => {
              const s = (u.status ?? 'active') as Status;
              return (
                <span
                  className={clsx(
                    'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium border',
                    STATUS_PILL[s],
                  )}
                  title={u.status_reason ?? undefined}
                >
                  <span className={clsx('w-1.5 h-1.5 rounded-full', STATUS_DOT[s])} />
                  {s.replace(/_/g, ' ')}
                </span>
              );
            },
          },
          {
            key: 'verification',
            header: 'Verification',
            render: (u: AdminUserRow) =>
              u.must_change_password ? (
                <span className="text-[11px] text-amber-700 dark:text-amber-300">
                  Pending password
                </span>
              ) : (
                <span className="text-[11px] text-emerald-700 dark:text-emerald-300">
                  ✓ Verified
                </span>
              ),
          },
          {
            key: 'last_login_at',
            header: 'Last login',
            render: (u: AdminUserRow) =>
              u.last_login_at ? (
                <span
                  className="text-xs text-foreground"
                  title={new Date(u.last_login_at).toLocaleString()}
                >
                  {relative(u.last_login_at)}
                </span>
              ) : (
                <span className="text-xs text-muted-foreground italic">Never</span>
              ),
          },
          {
            key: 'created_at',
            header: 'Joined',
            render: (u: AdminUserRow) => (
              <span className="text-xs text-muted-foreground">
                {new Date(u.created_at).toLocaleDateString()}
              </span>
            ),
          },
          {
            key: 'actions',
            header: '',
            align: 'right',
            render: (u: AdminUserRow) => (
              <RowActions
                row={u}
                isSelf={me?.id === u.id}
                busy={busyRowId === u.id}
                onView={() => {
                  /* navigation handled by Link inside menu */
                }}
                onSendReset={() => quickSendReset(u)}
                onDeactivate={() => quickSetStatus(u, 'inactive')}
                onSuspend={() => quickSetStatus(u, 'suspended')}
                onReactivate={() => quickSetStatus(u, 'active')}
              />
            ),
          },
        ]}
      />

      {/* Pagination */}
      {!loading && totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 text-sm">
          <div className="text-muted-foreground">
            Page {page} of {totalPages} · showing {data?.rows.length ?? 0} of{' '}
            {total.toLocaleString()}
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setParam('page', String(Math.max(1, page - 1)))}
              disabled={page <= 1}
            >
              ‹ Prev
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setParam('page', String(Math.min(totalPages, page + 1)))}
              disabled={page >= totalPages}
            >
              Next ›
            </Button>
          </div>
        </div>
      )}
    </Layout>
  );
}

function relative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.round(hr / 24);
  if (d < 14) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

// ---------------------------------------------------------------------------
// Per-row action menu — keeps the all-users page workflow self-contained so
// admins don't have to drill into the detail page just to deactivate someone.
//
// Self-protection lives at the action level (not the menu level) so the
// admin still sees "View profile" and "Send reset" for their own row, just
// no destructive options.
// ---------------------------------------------------------------------------
interface RowActionsProps {
  row: { id: string; status: Status | null; email: string };
  isSelf: boolean;
  busy: boolean;
  onView: () => void;
  onSendReset: () => void;
  onDeactivate: () => void;
  onSuspend: () => void;
  onReactivate: () => void;
}

function RowActions({
  row,
  isSelf,
  busy,
  onSendReset,
  onDeactivate,
  onSuspend,
  onReactivate,
}: RowActionsProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close when the user clicks anywhere outside the menu, or hits Escape.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const status = row.status ?? 'active';
  const isActive = status === 'active';

  return (
    <div ref={ref} className="relative inline-block text-left">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        className={clsx(
          'inline-flex items-center justify-center w-8 h-8 rounded-md border border-border',
          'text-muted-foreground hover:text-foreground hover:bg-muted transition press',
          busy && 'opacity-50 cursor-wait',
        )}
        aria-label="Actions"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {/* 3-dot icon */}
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <circle cx="3" cy="8" r="1.5" />
          <circle cx="8" cy="8" r="1.5" />
          <circle cx="13" cy="8" r="1.5" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 w-52 rounded-lg border border-border bg-card shadow-lg ring-1 ring-slate-900/5 overflow-hidden animate-fade-in-up"
        >
          <Link
            to={`/admin/users/${row.id}`}
            onClick={() => setOpen(false)}
            className="block px-3 py-2 text-sm text-foreground hover:bg-muted"
          >
            View profile
          </Link>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onSendReset();
            }}
            className="block w-full text-left px-3 py-2 text-sm text-foreground hover:bg-muted"
          >
            Send password reset
          </button>

          {!isSelf && <div className="h-px bg-muted" />}

          {!isSelf && isActive && (
            <>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onSuspend();
                }}
                className="block w-full text-left px-3 py-2 text-sm text-amber-700 dark:text-amber-300 hover:bg-amber-50"
              >
                Suspend
              </button>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onDeactivate();
                }}
                className="block w-full text-left px-3 py-2 text-sm text-red-700 dark:text-red-300 hover:bg-red-50"
              >
                Deactivate
              </button>
            </>
          )}
          {!isSelf && !isActive && (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onReactivate();
              }}
              className="block w-full text-left px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50"
            >
              Reactivate
            </button>
          )}
        </div>
      )}
    </div>
  );
}
