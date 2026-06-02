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

interface GroupGrant {
  id: string;
  group_id: string;
  created_at?: string;
}

/**
 * Admin-only modal: grant a Manager / HR Manager full co-management (recruiters,
 * consultants, pipeline, messaging) of ANOTHER group, alongside that group's own
 * lead. Mirrors the ManageManagersModal pattern on the Recruiters page.
 */
function ManageGroupGrantsModal({
  manager,
  groups,
  onClose,
}: {
  manager: ManagerRow;
  groups: { id: string; name: string }[];
  onClose: () => void;
}) {
  const [grants, setGrants] = useState<GroupGrant[]>([]);
  const [loading, setLoading] = useState(true);
  const [picking, setPicking] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  function reload() {
    setLoading(true);
    api
      .get(`/managers/${manager.id}/grants`)
      .then((r) => setGrants(r.data ?? []))
      .catch((e) => toast.error(e?.response?.data?.error ?? 'Failed to load grants'))
      .finally(() => setLoading(false));
  }
  useEffect(reload, [manager.id]);

  const grantedIds = new Set(grants.map((g) => g.group_id));
  const available = groups.filter(
    (g) => g.id !== (manager.group_id ?? '') && !grantedIds.has(g.id),
  );

  async function add() {
    if (!picking) return;
    setBusy('add');
    try {
      await api.post(`/managers/${manager.id}/grants`, { group_id: picking });
      toast.success('Co-management granted');
      setPicking('');
      reload();
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to grant');
    } finally {
      setBusy(null);
    }
  }

  async function remove(groupId: string) {
    if (!confirm('Revoke co-management of this group?')) return;
    setBusy('remove-' + groupId);
    try {
      await api.delete(`/managers/${manager.id}/grants/${groupId}`);
      toast.success('Co-management revoked');
      reload();
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to revoke');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal
      open={true}
      onClose={onClose}
      title={`Co-managed groups for ${manager.full_name ?? manager.email}`}
    >
      <div className="space-y-4">
        <p className="text-sm text-muted">
          Grant this lead full co-management — recruiters, consultants, pipeline and messaging — of
          another group, alongside that group’s own manager. Their own group stays unchanged.
        </p>

        {/* Current grants */}
        <div>
          <h3 className="text-[10px] font-semibold uppercase tracking-widest text-muted mb-1.5">
            Co-managed groups
          </h3>
          {loading ? (
            <p className="text-sm italic text-muted">Loading…</p>
          ) : grants.length === 0 ? (
            <p className="text-sm italic text-muted">No co-managed groups yet</p>
          ) : (
            <div className="space-y-1.5">
              {grants.map((g) => (
                <div
                  key={g.id}
                  className="flex items-center gap-2 border border-border rounded-lg px-3 py-2"
                >
                  <div className="flex-1 min-w-0">
                    <GroupBadge groupId={g.group_id} />
                  </div>
                  <Button
                    size="sm"
                    variant="danger-ghost"
                    onClick={() => remove(g.group_id)}
                    disabled={busy === 'remove-' + g.group_id}
                    loading={busy === 'remove-' + g.group_id}
                  >
                    Revoke
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Grant a new group */}
        <div>
          <h3 className="text-[10px] font-semibold uppercase tracking-widest text-muted mb-1.5">
            Grant another group
          </h3>
          {available.length === 0 ? (
            <p className="text-sm italic text-muted">No other groups available to grant.</p>
          ) : (
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <SelectInput
                  placeholder="Pick a group…"
                  value={picking}
                  onChange={(e) => setPicking(e.target.value)}
                  options={available.map((g) => ({ value: g.id, label: g.name }))}
                />
              </div>
              <Button onClick={add} disabled={!picking} loading={busy === 'add'}>
                {busy === 'add' ? 'Granting' : '+ Grant'}
              </Button>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

export function Managers() {
  const { profile } = useAuth();
  const { groups } = useUserGroups();
  const canEditGroup = !!profile && (ADMIN_TIER as readonly string[]).includes(profile.role);
  const [grantsFor, setGrantsFor] = useState<ManagerRow | null>(null);

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
              onManageGrants={canEditGroup ? () => setGrantsFor(m) : undefined}
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
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="ghost" onClick={() => setGrantsFor(m)}>
                          Co-managed groups
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => openGroupEdit(m)}>
                          Move group
                        </Button>
                      </div>
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

      {grantsFor && (
        <ManageGroupGrantsModal
          manager={grantsFor}
          groups={groups}
          onClose={() => setGrantsFor(null)}
        />
      )}
    </Layout>
  );
}
