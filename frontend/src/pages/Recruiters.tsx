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
import { RecruiterCard, filterRecruiters } from '../components/RecruiterCard';
import { EmptyState } from '../components/EmptyState';
import { SkeletonCard } from '../components/Skeleton';
import { IconSearch, IconUsers } from '../components/Icons';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { Role, ROLE_LABEL, ADMIN_TIER, MANAGER_TIER } from '../types';

interface ManagerLink {
  is_primary: boolean;
  assigned_at: string;
  manager: {
    id: string;
    email: string;
    full_name?: string | null;
    role?: Role;
    group_id?: string | null;
  } | null;
}

interface RecruiterRow {
  id: string;
  team?: string | null;
  target_submissions_per_week?: number | null;
  notes?: string | null;
  consultant_count?: number;
  user?: {
    id: string;
    full_name?: string | null;
    email?: string | null;
    group_id?: string | null;
  } | null;
  // legacy single manager (back-compat)
  manager?: { id: string; full_name?: string | null; email?: string | null } | null;
  // new many-to-many
  managers?: ManagerLink[];
}

interface CandidateUser {
  id: string;
  email: string;
  full_name?: string | null;
  role: Role;
  group_id?: string | null;
}

interface ManagerCandidate {
  id: string;
  email: string;
  full_name?: string | null;
  role: Role;
  group_id?: string | null;
}

const MANAGER_TIER_SET = new Set(MANAGER_TIER);

export function Recruiters() {
  const { profile } = useAuth();
  const { groups } = useUserGroups();
  const isAdminTierUser = !!profile && (ADMIN_TIER as readonly string[]).includes(profile.role);
  const { query, setQuery } = useEntityList<Record<string, never>>({});
  const [rows, setRows] = useState<RecruiterRow[]>([]);
  const [candidates, setCandidates] = useState<CandidateUser[]>([]);
  const [groupManagers, setGroupManagers] = useState<ManagerCandidate[]>([]);
  const [picked, setPicked] = useState<RecruiterRow | null>(null);
  const [loading, setLoading] = useState(true);
  // Group edit state
  const [groupPicked, setGroupPicked] = useState<RecruiterRow | null>(null);
  const [selectedGroup, setSelectedGroup] = useState('');
  const [selectedGroupManager, setSelectedGroupManager] = useState('');
  const [confirmGroupMoveOpen, setConfirmGroupMoveOpen] = useState(false);
  const [savingGroup, setSavingGroup] = useState(false);

  function load() {
    setLoading(true);
    api
      .get('/recruiters')
      .then((r) => setRows(r.data ?? []))
      .catch((e) => toast.error(e?.response?.data?.error ?? 'Failed to load recruiters'))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // Pull the message directory — it returns users we can chat with. For
    // manager-tier the response is the full org, which is what we want here.
    // Falls back to silently empty if the endpoint isn't reachable.
    api
      .get('/messages/directory')
      .then((r) => {
        const users: CandidateUser[] = (r.data ?? []).filter(
          (u: CandidateUser) => u.role && MANAGER_TIER_SET.has(u.role as Role),
        );
        setCandidates(users);
      })
      .catch(() => setCandidates([]));
    api
      .get('/managers')
      .then((r) => setGroupManagers(r.data ?? []))
      .catch(() => setGroupManagers([]));
  }, []);

  function openGroupEdit(r: RecruiterRow) {
    const currentGroup = r.user?.group_id ?? '';
    const managers = effectiveManagers(r);
    const currentManager =
      managers.find((m) => m.is_primary && m.manager?.group_id === currentGroup)?.manager ??
      managers.find((m) => m.manager?.group_id === currentGroup)?.manager;
    setGroupPicked(r);
    setSelectedGroup(currentGroup);
    setSelectedGroupManager(currentManager?.id ?? '');
    setConfirmGroupMoveOpen(false);
  }

  async function saveGroup() {
    if (!groupPicked) return;
    if (selectedGroup && !selectedGroupManager) {
      toast.error('Pick a manager in the selected group');
      return;
    }
    setConfirmGroupMoveOpen(true);
  }

  async function confirmSaveGroup() {
    if (!groupPicked) return;
    setSavingGroup(true);
    try {
      await api.post(`/recruiters/${groupPicked.id}/move-group`, {
        group_id: selectedGroup || null,
        manager_id: selectedGroup ? selectedGroupManager : null,
        confirm_unassign_consultants: true,
      });
      toast.success('Group updated');
      invalidateUserGroupsCache();
      setConfirmGroupMoveOpen(false);
      setGroupPicked(null);
      setSelectedGroupManager('');
      load();
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to update group');
    } finally {
      setSavingGroup(false);
    }
  }

  function effectiveManagers(r: RecruiterRow): ManagerLink[] {
    if (r.managers && r.managers.length > 0) {
      return r.managers.filter((m) => m.manager);
    }
    // Fallback to the legacy single manager (pre-migration).
    if (r.manager) {
      return [
        {
          is_primary: true,
          assigned_at: new Date().toISOString(),
          manager: {
            id: r.manager.id,
            email: r.manager.email ?? '',
            full_name: r.manager.full_name,
          },
        },
      ];
    }
    return [];
  }

  const managersForSelectedGroup = selectedGroup
    ? groupManagers.filter((m) => m.group_id === selectedGroup)
    : [];
  const selectedGroupManagerName =
    groupManagers.find((m) => m.id === selectedGroupManager)?.full_name ??
    groupManagers.find((m) => m.id === selectedGroupManager)?.email ??
    'the selected manager';
  const supervisorCandidates =
    profile && MANAGER_TIER_SET.has(profile.role)
      ? [
          ...candidates,
          {
            id: profile.id,
            email: profile.email,
            full_name: profile.full_name,
            role: profile.role,
            group_id: profile.group_id ?? null,
          },
        ].filter((u, idx, arr) => arr.findIndex((x) => x.id === u.id) === idx)
      : candidates;

  return (
    <Layout title="Recruiters">
      <PageHeader
        title="Recruiters"
        description="The team and reporting lines. Manage supervisor assignments per recruiter."
      />

      {/* ── Search bar (both breakpoints) ── */}
      <div
        className="flex items-center gap-2 h-10 px-3 rounded-xl mb-4"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)', maxWidth: 360 }}
      >
        <IconSearch size={15} className="text-muted shrink-0" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search recruiters…"
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
            <SkeletonCard />
          </>
        ) : filterRecruiters(rows, query).length === 0 ? (
          <EmptyState
            icon={<IconUsers size={22} className="text-muted" />}
            title="No recruiters found"
            description={query ? 'Try a different search.' : 'No recruiters on the team yet.'}
            compact
          />
        ) : (
          filterRecruiters(rows, query).map((r) => (
            <RecruiterCard
              key={r.id}
              recruiter={{
                ...r,
                primaryManager: effectiveManagers(r)[0]?.manager?.full_name ?? null,
              }}
              onSupervisors={() => setPicked(r)}
              onGroup={() => openGroupEdit(r)}
            />
          ))
        )}
      </div>

      {/* ── Desktop DataTable (≥ md) ── */}
      <div className="hidden md:block">
        <DataTable
          rows={filterRecruiters(rows, query) as RecruiterRow[]}
          loading={loading}
          empty="No recruiters yet."
          columns={[
            {
              key: 'name',
              header: 'Name',
              render: (r: RecruiterRow) =>
                r.user?.id ? (
                  <Link
                    to={`/users/${r.user.id}`}
                    className="inline-flex items-center gap-2 hover:bg-hover rounded-md -mx-1 px-1 py-0.5"
                  >
                    <Avatar name={r.user?.full_name} email={r.user?.email} size={26} />
                    <div className="text-sm font-medium text-ink hover:underline">
                      {r.user?.full_name ?? r.user?.email ?? '—'}
                    </div>
                  </Link>
                ) : (
                  <div className="inline-flex items-center gap-2">
                    <Avatar name={r.user?.full_name} email={r.user?.email} size={26} />
                    <div className="text-sm font-medium text-ink">
                      {r.user?.full_name ?? r.user?.email ?? '—'}
                    </div>
                  </div>
                ),
            },
            { key: 'team', header: 'Team', hideOnMobile: true },
            {
              key: 'group',
              header: 'Group',
              hideOnMobile: true,
              render: (r: RecruiterRow) => <GroupBadge groupId={r.user?.group_id ?? null} />,
            },
            {
              key: 'consultants',
              header: 'Consultants',
              align: 'right',
              render: (r: RecruiterRow) => {
                const n = r.consultant_count ?? 0;
                if (n === 0) return <span className="text-xs text-muted">0</span>;
                // Drill-down: jump to the consultants list filtered to this recruiter.
                return (
                  <Link
                    to={`/consultants?recruiter=${r.id}`}
                    className="inline-flex items-center justify-center min-w-[1.75rem] rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700 hover:bg-brand-100"
                    title={`View ${n} consultant${n === 1 ? '' : 's'} assigned to this recruiter`}
                  >
                    {n}
                  </Link>
                );
              },
            },
            {
              key: 'managers',
              header: 'Reports to',
              render: (r: RecruiterRow) => {
                const mgrs = effectiveManagers(r);
                if (mgrs.length === 0)
                  return <span className="text-xs italic text-muted">None</span>;
                return (
                  <div className="flex flex-wrap gap-1.5">
                    {mgrs.map((m) => (
                      <span
                        key={m.manager!.id}
                        className={clsx(
                          'inline-flex items-center gap-1.5 text-xs rounded-full px-2 py-0.5 border',
                          m.is_primary
                            ? 'bg-brand-50 text-brand-700 border-brand-200'
                            : 'bg-hover text-ink border-border',
                        )}
                        title={m.is_primary ? 'Primary supervisor' : 'Secondary supervisor'}
                      >
                        <Avatar name={m.manager!.full_name} email={m.manager!.email} size={16} />
                        <span>{m.manager!.full_name ?? m.manager!.email}</span>
                        {m.is_primary && <span className="text-[10px]">★</span>}
                      </span>
                    ))}
                  </div>
                );
              },
            },
            {
              key: 'target',
              header: 'Weekly target',
              align: 'right',
              hideOnMobile: true,
              render: (r: RecruiterRow) => r.target_submissions_per_week ?? '—',
            },
            {
              key: 'actions',
              header: '',
              align: 'right',
              render: (r: RecruiterRow) => (
                <div className="flex items-center justify-end gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setPicked(r)}>
                    Supervisors
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => openGroupEdit(r)}>
                    Group
                  </Button>
                </div>
              ),
            },
          ]}
        />
      </div>
      {/* end desktop DataTable */}

      {/* Group edit modal */}
      <Modal
        open={!!groupPicked}
        onClose={() => setGroupPicked(null)}
        title={`Move ${groupPicked?.user?.full_name ?? 'recruiter'} to a group`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setGroupPicked(null)}>
              Cancel
            </Button>
            <Button
              onClick={saveGroup}
              loading={savingGroup}
              disabled={
                selectedGroup === (groupPicked?.user?.group_id ?? '') ||
                (!!selectedGroup && !selectedGroupManager)
              }
            >
              {savingGroup ? 'Saving' : 'Save'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {(groupPicked?.consultant_count ?? 0) > 0 && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
              This recruiter has{' '}
              <span className="font-medium">{groupPicked!.consultant_count}</span> consultant
              {groupPicked!.consultant_count === 1 ? '' : 's'} assigned. They will be unassigned
              when this recruiter moves.
            </p>
          )}
          <SelectInput
            label="Group"
            placeholder="No group (clear)"
            value={selectedGroup}
            onChange={(e) => {
              const nextGroup = e.target.value;
              setSelectedGroup(nextGroup);
              setSelectedGroupManager(
                groupManagers.find((m) => m.group_id === nextGroup)?.id ?? '',
              );
            }}
            options={(isAdminTierUser
              ? groups
              : groups.filter((g) => g.id === profile?.group_id)
            ).map((g) => ({ value: g.id, label: g.name }))}
          />
          {selectedGroup && (
            <SelectInput
              label="Manager in selected group"
              placeholder="Select a manager..."
              value={selectedGroupManager}
              onChange={(e) => setSelectedGroupManager(e.target.value)}
              options={managersForSelectedGroup.map((m) => ({
                value: m.id,
                label: `${m.full_name ?? m.email}${m.role ? ` (${ROLE_LABEL[m.role]})` : ''}`,
              }))}
            />
          )}
          {selectedGroup && managersForSelectedGroup.length === 0 && (
            <p className="text-xs text-danger">No managers are in the selected group.</p>
          )}
        </div>
      </Modal>

      <Modal
        open={confirmGroupMoveOpen}
        onClose={() => setConfirmGroupMoveOpen(false)}
        title="Confirm group change"
        description="Moving this recruiter will detach their consultant assignments."
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmGroupMoveOpen(false)}>
              Cancel
            </Button>
            <Button onClick={confirmSaveGroup} loading={savingGroup}>
              Confirm
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink">
          Move{' '}
          <span className="font-semibold">
            {groupPicked?.user?.full_name ?? groupPicked?.user?.email ?? 'this recruiter'}
          </span>
          ? All Consultants under this Recruiter will be unassigned, and this Recruiter will report
          to <span className="font-semibold">{selectedGroupManagerName}</span>.
        </p>
      </Modal>

      {picked && (
        <ManageManagersModal
          recruiter={picked}
          candidates={supervisorCandidates}
          existing={effectiveManagers(picked)}
          currentUserId={profile?.id ?? null}
          onClose={() => setPicked(null)}
          onChanged={async () => {
            // Refetch the recruiter list and re-pin `picked` to the
            // refreshed row so the modal's "Current supervisors" panel
            // reflects the just-applied change. Previously the modal kept
            // showing the stale row until the user closed and reopened.
            try {
              const r = await api.get('/recruiters');
              const fresh = (r.data ?? []) as RecruiterRow[];
              setRows(fresh);
              const refreshed = fresh.find((row) => row.id === picked.id);
              if (refreshed) setPicked(refreshed);
            } catch (e: any) {
              toast.error(e?.response?.data?.error ?? 'Failed to refresh recruiters');
            }
          }}
        />
      )}
    </Layout>
  );
}

function ManageManagersModal({
  recruiter,
  candidates,
  existing,
  currentUserId,
  onClose,
  onChanged,
}: {
  recruiter: RecruiterRow;
  candidates: CandidateUser[];
  existing: ManagerLink[];
  currentUserId: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [picking, setPicking] = useState('');

  const existingIds = new Set(existing.map((m) => m.manager!.id));
  const recruiterGroup = recruiter.user?.group_id ?? null;
  const available = candidates.filter(
    (u) =>
      !existingIds.has(u.id) &&
      u.id !== recruiter.user?.id &&
      (u.id === currentUserId || u.group_id === recruiterGroup),
  );

  async function add() {
    if (!picking) return;
    setBusy('add');
    try {
      await api.post(`/recruiters/${recruiter.id}/managers`, { manager_id: picking });
      toast.success('Supervisor added');
      setPicking('');
      onChanged();
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to add');
    } finally {
      setBusy(null);
    }
  }

  async function remove(managerId: string) {
    if (!confirm('Remove this supervisor?')) return;
    setBusy('remove-' + managerId);
    try {
      await api.delete(`/recruiters/${recruiter.id}/managers/${managerId}`);
      toast.success('Supervisor removed');
      onChanged();
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to remove');
    } finally {
      setBusy(null);
    }
  }

  async function makePrimary(managerId: string) {
    setBusy('primary-' + managerId);
    try {
      await api.post(`/recruiters/${recruiter.id}/managers/${managerId}/primary`);
      toast.success('Primary supervisor set');
      onChanged();
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Something went wrong. Please try again.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal
      open={true}
      onClose={onClose}
      title={`Supervisors for ${recruiter.user?.full_name ?? recruiter.user?.email ?? 'recruiter'}`}
    >
      <div className="space-y-4">
        <p className="text-sm text-muted">
          A recruiter can report to multiple managers / directors. The{' '}
          <span className="font-medium text-brand-700">★ primary</span> supervisor appears as their
          default in reports.
        </p>

        {/* Existing managers */}
        <div>
          <h3 className="text-[10px] font-semibold uppercase tracking-widest text-muted mb-1.5">
            Current supervisors
          </h3>
          {existing.length === 0 ? (
            <p className="text-sm italic text-muted">None assigned yet</p>
          ) : (
            <div className="space-y-1.5">
              {existing.map((m) => (
                <div
                  key={m.manager!.id}
                  className="flex items-center gap-2 border border-border rounded-lg px-3 py-2"
                >
                  <Avatar name={m.manager!.full_name} email={m.manager!.email} size={28} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-ink truncate">
                      {m.manager!.full_name ?? m.manager!.email}
                    </div>
                    <div className="text-[10px] uppercase tracking-wider text-muted">
                      {m.manager!.role && ROLE_LABEL[m.manager!.role]}
                      {m.is_primary && <span className="ml-2 text-brand-700">★ Primary</span>}
                    </div>
                  </div>
                  {!m.is_primary && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => makePrimary(m.manager!.id)}
                      disabled={busy === 'primary-' + m.manager!.id}
                      loading={busy === 'primary-' + m.manager!.id}
                    >
                      Make primary
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="danger-ghost"
                    onClick={() => remove(m.manager!.id)}
                    disabled={busy === 'remove-' + m.manager!.id}
                    loading={busy === 'remove-' + m.manager!.id}
                  >
                    Remove
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Add a new manager */}
        <div>
          <h3 className="text-[10px] font-semibold uppercase tracking-widest text-muted mb-1.5">
            Add a supervisor
          </h3>
          {available.length === 0 ? (
            <p className="text-sm italic text-muted">No more eligible supervisors available.</p>
          ) : (
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <SelectInput
                  placeholder="Pick a manager or director…"
                  value={picking}
                  onChange={(e) => setPicking(e.target.value)}
                  options={available.map((u) => ({
                    value: u.id,
                    label:
                      (u.full_name ?? u.email) +
                      (u.id === currentUserId ? ' (myself)' : '') +
                      (u.role ? ` (${ROLE_LABEL[u.role]})` : ''),
                  }))}
                />
              </div>
              <Button onClick={add} disabled={!picking} loading={busy === 'add'}>
                {busy === 'add' ? 'Adding' : '+ Add'}
              </Button>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
