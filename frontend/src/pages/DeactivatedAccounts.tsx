import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Layout } from '../components/Layout';
import { DataTable } from '../components/DataTable';
import { PageHeader } from '../components/PageHeader';
import { SelectInput } from '../components/SelectInput';
import { Button } from '../components/Button';
import { GroupBadge } from '../components/GroupBadge';
import { api } from '../services/api';
import { invalidate, useInvalidationListener } from '../hooks/useInvalidate';
import { ALL_ROLES, ROLE_LABEL, Role } from '../types';

type Status = 'active' | 'inactive' | 'suspended' | 'pending_verification' | 'banned';

interface DeactivatedRow {
  id: string;
  email: string;
  full_name: string | null;
  role: Role;
  is_active: boolean;
  status: Status | null;
  status_reason: string | null;
  status_changed_at: string | null;
  last_seen_at: string | null;
  updated_at: string | null;
  created_at: string | null;
  group_id: string | null;
}

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

type RoleFilter = 'ALL' | Role;

const ROLE_OPTIONS: { value: RoleFilter; label: string }[] = [
  { value: 'ALL', label: 'All roles' },
  ...ALL_ROLES.map((r) => ({ value: r as RoleFilter, label: ROLE_LABEL[r] })),
];

/**
 * Admin view of every deactivated account. Filterable by role. Each row links
 * to the user's profile where the admin can reactivate or hard-delete.
 *
 * Mounted under /admin/deactivated, gated by ADMIN_TIER in the router.
 */
export function DeactivatedAccounts() {
  const nav = useNavigate();
  const [rows, setRows] = useState<DeactivatedRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<RoleFilter>('ALL');
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load(filter: RoleFilter) {
    setLoading(true);
    try {
      const r = await api.get('/users/deactivated', {
        params: filter === 'ALL' ? {} : { role: filter },
      });
      setRows(r.data ?? []);
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to load deactivated accounts');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(role);
  }, [role]);

  // Refetch whenever any sibling page mutates a user — keeps this list
  // honest if an admin reactivated someone from /admin/users or
  // /admin/users/:id and then comes back here.
  useInvalidationListener('users', () => {
    load(role);
  });

  async function reactivate(row: DeactivatedRow) {
    if (busyId) return;
    setBusyId(row.id);
    try {
      await api.post(`/users/${row.id}/reactivate`);
      toast.success(`${row.email} reactivated`);
      // Remove from the list locally — the row is no longer deactivated.
      setRows((rs) => rs.filter((x) => x.id !== row.id));
      // Notify sibling pages so the list / detail views refetch the
      // restored account's status.
      invalidate('users');
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to reactivate');
    } finally {
      setBusyId(null);
    }
  }

  // Per-role count for the empty/summary state. Computed off the *unfiltered*
  // server response would be nicer, but the filter already lives server-side;
  // this is just a quick post-fetch tally for the visible set.
  const tally = useMemo(() => {
    const m = new Map<Role, number>();
    for (const r of rows) m.set(r.role, (m.get(r.role) ?? 0) + 1);
    return m;
  }, [rows]);

  return (
    <Layout title="Deactivated accounts">
      <div className="animate-fade-in-down">
        <PageHeader
          title="Deactivated accounts"
          description="Every account that's currently blocked from signing in — inactive, suspended, banned, or pending verification. Reactivate from here, or open a profile to delete permanently."
        />
      </div>

      <div className="mb-4 flex items-end gap-3 max-w-xs animate-fade-in-up">
        <SelectInput
          label="Filter by role"
          value={role}
          onChange={(e) => setRole(e.target.value as RoleFilter)}
          options={ROLE_OPTIONS.map((o) => ({
            value: o.value,
            label:
              o.value !== 'ALL' && tally.get(o.value as Role)
                ? `${o.label} (${tally.get(o.value as Role)})`
                : o.label,
          }))}
        />
      </div>

      <DataTable
        loading={loading}
        empty={
          role === 'ALL'
            ? 'No deactivated accounts. Nothing to see here.'
            : `No deactivated ${ROLE_LABEL[role as Role]} accounts.`
        }
        columns={[
          {
            key: 'email',
            header: 'User',
            render: (r: DeactivatedRow) => (
              <button onClick={() => nav(`/users/${r.id}`)} className="text-left hover:underline">
                <div className="font-medium text-foreground">{r.full_name || r.email}</div>
                {r.full_name && <div className="text-xs text-muted-foreground">{r.email}</div>}
              </button>
            ),
          },
          {
            key: 'role',
            header: 'Role',
            render: (r: DeactivatedRow) => (
              <span className="text-[11px] font-medium bg-muted text-foreground px-1.5 py-0.5 rounded">
                {ROLE_LABEL[r.role] ?? r.role}
              </span>
            ),
          },
          {
            key: 'group',
            header: 'Group',
            render: (r: DeactivatedRow) => <GroupBadge groupId={r.group_id} />,
          },
          {
            key: 'status',
            header: 'Status',
            render: (r: DeactivatedRow) => {
              // status is the canonical field; fall back to is_active for
              // pre-migration rows so old deactivations still render.
              const s: Status = r.status ?? (r.is_active === false ? 'inactive' : 'active');
              return (
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${STATUS_PILL[s]}`}
                  title={r.status_reason ?? undefined}
                >
                  {s.replace(/_/g, ' ')}
                </span>
              );
            },
          },
          {
            key: 'status_changed_at',
            header: 'Changed',
            render: (r: DeactivatedRow) => {
              const at = r.status_changed_at ?? r.updated_at;
              return at ? new Date(at).toLocaleString() : '—';
            },
          },
          {
            key: 'last_seen_at',
            header: 'Last seen',
            render: (r: DeactivatedRow) =>
              r.last_seen_at ? (
                new Date(r.last_seen_at).toLocaleString()
              ) : (
                <span className="text-muted-foreground">Never</span>
              ),
          },
          {
            key: 'actions',
            header: '',
            align: 'right',
            render: (r: DeactivatedRow) => (
              <div className="flex items-center justify-end gap-1">
                <Button size="sm" variant="ghost" onClick={() => nav(`/users/${r.id}`)}>
                  Open profile
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  loading={busyId === r.id}
                  onClick={() => reactivate(r)}
                  className="text-emerald-700 dark:text-emerald-300 hover:text-emerald-800"
                >
                  Reactivate
                </Button>
              </div>
            ),
          },
        ]}
        rows={rows}
      />
    </Layout>
  );
}
