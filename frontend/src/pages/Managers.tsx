import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { DataTable } from '../components/DataTable';
import { Modal } from '../components/Modal';
import { Avatar } from '../components/TaskBits';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/Button';
import { SelectInput } from '../components/SelectInput';
import { GroupBadge, useUserGroups, invalidateUserGroupsCache } from '../components/GroupBadge';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useEntityList } from '../hooks/useEntityList';
import { ManagerCard, filterManagers } from '../components/ManagerCard';
import { KpiCard } from '../components/KpiCard';
import { EmptyState } from '../components/EmptyState';
import { SkeletonCard } from '../components/Skeleton';
import { IconSearch, IconUsers } from '../components/Icons';
import { ADMIN_TIER, ROLE_LABEL, type Role } from '../types';
import toast from 'react-hot-toast';

interface ManagerRow {
  id: string;
  email: string;
  full_name?: string | null;
  role: Role;
  status?: string | null;
  group_id?: string | null;
  recruiter_count: number;
  last_login_at?: string | null;
}

function StatusPill({ status }: { status?: string | null }) {
  const active = (status ?? 'active') === 'active';
  return (
    <span
      className={
        active
          ? 'inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-300'
          : 'inline-flex items-center gap-1.5 rounded-full border border-border bg-hover px-2 py-0.5 text-xs font-medium text-muted'
      }
    >
      <span
        className={
          active ? 'size-1.5 rounded-full bg-emerald-500' : 'size-1.5 rounded-full bg-slate-400'
        }
      />
      {status ?? 'active'}
    </span>
  );
}

function RolePill({ role }: { role: Role }) {
  const hr = role === 'HR_MANAGER';
  return (
    <span
      className={
        hr
          ? 'inline-flex rounded-full border border-violet-500/20 bg-violet-500/10 px-2 py-0.5 text-xs font-medium text-violet-600 dark:text-violet-300'
          : 'inline-flex rounded-full border border-sky-500/20 bg-sky-500/10 px-2 py-0.5 text-xs font-medium text-sky-700 dark:text-sky-300'
      }
    >
      {ROLE_LABEL[role] ?? role}
    </span>
  );
}

export function Managers() {
  const { profile } = useAuth();
  const { groups } = useUserGroups();
  const canEditGroup = !!profile && (ADMIN_TIER as readonly string[]).includes(profile.role);

  const { query, setQuery } = useEntityList<Record<string, never>>({});
  const [rows, setRows] = useState<ManagerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [picked, setPicked] = useState<ManagerRow | null>(null);
  const [selectedGroup, setSelectedGroup] = useState('');
  const [confirmGroupMoveOpen, setConfirmGroupMoveOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  function load() {
    setLoading(true);
    api
      .get('/managers')
      .then((r) => setRows(r.data ?? []))
      .catch((e) => toast.error(e?.response?.data?.error ?? 'Failed to load managers'))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  function openGroupEdit(m: ManagerRow) {
    setPicked(m);
    setSelectedGroup(m.group_id ?? '');
    setConfirmGroupMoveOpen(false);
  }

  async function saveGroup() {
    if (!picked) return;
    setConfirmGroupMoveOpen(true);
  }

  async function confirmSaveGroup() {
    if (!picked) return;
    setSaving(true);
    try {
      await api.post(`/managers/${picked.id}/move-group`, {
        group_id: selectedGroup || null,
        confirm_unassign_recruiters: true,
      });
      toast.success('Group updated');
      invalidateUserGroupsCache();
      setConfirmGroupMoveOpen(false);
      setPicked(null);
      load();
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to update group');
    } finally {
      setSaving(false);
    }
  }

  const totalRecruiters = rows.reduce((sum, r) => sum + (r.recruiter_count ?? 0), 0);
  const hrManagers = rows.filter((r) => r.role === 'HR_MANAGER').length;
  const managers = rows.filter((r) => r.role === 'MANAGER').length;
  const selectedGroupName =
    groups.find((g) => g.id === selectedGroup)?.name ??
    (selectedGroup ? 'selected group' : 'No group');

  return (
    <Layout title="Managers">
      <PageHeader title="Managers" description="Manage Manager and HR Manager group assignments." />

      {/* ── KPI summary row ── */}
      <div className="mb-5 grid grid-cols-2 md:grid-cols-4 gap-4 stagger-children">
        <KpiCard label="Total leads" value={rows.length} accent="brand" />
        <KpiCard label="Managers" value={managers} accent="blue" />
        <KpiCard label="HR Managers" value={hrManagers} accent="slate" />
        <KpiCard label="Assigned recruiters" value={totalRecruiters} accent="green" />
      </div>

      {/* ── Search bar (both breakpoints) ── */}
      <div
        className="flex items-center gap-2 h-10 px-3 rounded-xl mb-4"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)', maxWidth: 360 }}
      >
        <IconSearch size={15} className="text-muted shrink-0" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search managers…"
          className="flex-1 bg-transparent outline-none text-ink placeholder:text-muted"
          style={{ fontSize: 15 }}
        />
      </div>

      {/* ── Mobile cards (< md) ── */}
      <div className="flex md:hidden flex-col gap-3 mb-4">
        {loading ? (
          <>
            <SkeletonCard />
            <SkeletonCard />
          </>
        ) : filterManagers(rows, query).length === 0 ? (
          <EmptyState
            icon={<IconUsers size={22} className="text-muted" />}
            title="No managers found"
            description={query ? 'Try a different search.' : 'No managers yet.'}
            compact
          />
        ) : (
          (filterManagers(rows, query) as ManagerRow[]).map((m) => (
            <ManagerCard
              key={m.id}
              manager={m}
              onMoveGroup={canEditGroup ? () => openGroupEdit(m) : undefined}
            />
          ))
        )}
      </div>

      {/* ── Desktop DataTable (≥ md) ── */}
      <div className="hidden md:block">
        <DataTable
          rows={filterManagers(rows, query) as ManagerRow[]}
          loading={loading}
          empty="No managers found."
          columns={[
            {
              key: 'name',
              header: 'Name',
              className: 'min-w-[260px]',
              render: (m: ManagerRow) => (
                <Link
                  to={`/users/${m.id}`}
                  className="inline-flex max-w-full items-center gap-2.5 rounded-md -mx-1 px-1 py-0.5 hover:bg-hover"
                >
                  <Avatar name={m.full_name} email={m.email} size={30} />
                  <div className="min-w-0 leading-tight">
                    <div className="text-sm font-medium text-ink hover:underline">
                      {m.full_name ?? m.email}
                    </div>
                    {m.full_name && <div className="text-[11px] text-muted">{m.email}</div>}
                  </div>
                </Link>
              ),
            },
            {
              key: 'role',
              header: 'Role',
              render: (m: ManagerRow) => <RolePill role={m.role} />,
            },
            {
              key: 'group',
              header: 'Group',
              render: (m: ManagerRow) => <GroupBadge groupId={m.group_id ?? null} />,
            },
            {
              key: 'recruiters',
              header: 'Recruiters',
              align: 'center',
              hideOnMobile: true,
              render: (m: ManagerRow) =>
                m.recruiter_count > 0 ? (
                  <Link
                    to={`/recruiters`}
                    className="inline-flex items-center gap-1.5 rounded-full border border-brand-500/20 bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700 hover:bg-brand-100"
                    title={`${m.recruiter_count} recruiter${m.recruiter_count === 1 ? '' : 's'}`}
                  >
                    <span>{m.recruiter_count}</span>
                    <span className="font-medium opacity-75">
                      {m.recruiter_count === 1 ? 'recruiter' : 'recruiters'}
                    </span>
                  </Link>
                ) : (
                  <span className="inline-flex items-center rounded-full border border-border bg-hover px-2.5 py-1 text-xs text-muted">
                    none
                  </span>
                ),
            },
            {
              key: 'status',
              header: 'Status',
              hideOnMobile: true,
              render: (m: ManagerRow) => <StatusPill status={m.status} />,
            },
            ...(canEditGroup
              ? [
                  {
                    key: 'actions',
                    header: '',
                    align: 'right' as const,
                    render: (m: ManagerRow) => (
                      <Button size="sm" variant="outline" onClick={() => openGroupEdit(m)}>
                        Move group
                      </Button>
                    ),
                  },
                ]
              : []),
          ]}
        />
      </div>
      {/* end desktop DataTable */}

      <Modal
        open={!!picked}
        onClose={() => setPicked(null)}
        title={`Move ${picked?.full_name ?? picked?.email ?? 'manager'} to a group`}
        description="Choose the group this manager belongs to."
        footer={
          <>
            <Button variant="secondary" onClick={() => setPicked(null)}>
              Cancel
            </Button>
            <Button
              onClick={saveGroup}
              loading={saving}
              disabled={selectedGroup === (picked?.group_id ?? '')}
            >
              {saving ? 'Saving' : 'Save'}
            </Button>
          </>
        }
      >
        <SelectInput
          label="Group"
          placeholder="No group (clear)"
          value={selectedGroup}
          onChange={(e) => setSelectedGroup(e.target.value)}
          options={groups.map((g) => ({ value: g.id, label: g.name }))}
        />
      </Modal>

      <Modal
        open={confirmGroupMoveOpen}
        onClose={() => setConfirmGroupMoveOpen(false)}
        title="Confirm group change"
        description="Moving this manager will detach their recruiter assignments."
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmGroupMoveOpen(false)}>
              Cancel
            </Button>
            <Button onClick={confirmSaveGroup} loading={saving}>
              Confirm
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-ink">
            Move{' '}
            <span className="font-semibold">
              {picked?.full_name ?? picked?.email ?? 'this manager'}
            </span>{' '}
            to <span className="font-semibold">{selectedGroupName}</span>?
          </p>
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
            All Recruiters under this Manager will be unassigned.
          </div>
        </div>
      </Modal>
    </Layout>
  );
}
