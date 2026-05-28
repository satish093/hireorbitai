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
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { Role, ROLE_LABEL, ADMIN_TIER, MANAGER_TIER } from '../types';

interface ManagerLink {
  is_primary: boolean;
  assigned_at: string;
  manager: { id: string; email: string; full_name?: string | null; role?: Role } | null;
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
}

const MANAGER_TIER_SET = new Set(MANAGER_TIER);

export function Recruiters() {
  const { profile } = useAuth();
  const { groups } = useUserGroups();
  const isAdminTierUser = !!profile && (ADMIN_TIER as readonly string[]).includes(profile.role);
  const [rows, setRows] = useState<RecruiterRow[]>([]);
  const [candidates, setCandidates] = useState<CandidateUser[]>([]);
  const [picked, setPicked] = useState<RecruiterRow | null>(null);
  const [loading, setLoading] = useState(true);
  // Group edit state
  const [groupPicked, setGroupPicked] = useState<RecruiterRow | null>(null);
  const [selectedGroup, setSelectedGroup] = useState('');
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
  }, []);

  function openGroupEdit(r: RecruiterRow) {
    setGroupPicked(r);
    setSelectedGroup(r.user?.group_id ?? '');
  }

  async function saveGroup() {
    if (!groupPicked) return;
    setSavingGroup(true);
    try {
      await api.post(`/recruiters/${groupPicked.id}/move-group`, {
        group_id: selectedGroup || null,
      });
      toast.success('Group updated');
      invalidateUserGroupsCache();
      setGroupPicked(null);
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

  return (
    <Layout title="Recruiters">
      <PageHeader
        title="Recruiters"
        description="The team and reporting lines. Manage supervisor assignments per recruiter."
      />
      <DataTable
        rows={rows}
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
              if (mgrs.length === 0) return <span className="text-xs italic text-muted">None</span>;
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
              disabled={selectedGroup === (groupPicked?.user?.group_id ?? '')}
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
              {groupPicked!.consultant_count === 1 ? '' : 's'} assigned. All their consultants must
              already be in the target group — the backend will block the move if any are in a
              different group.
            </p>
          )}
          <SelectInput
            label="Group"
            placeholder="No group (clear)"
            value={selectedGroup}
            onChange={(e) => setSelectedGroup(e.target.value)}
            options={(isAdminTierUser
              ? groups
              : groups.filter((g) => g.id === profile?.group_id)
            ).map((g) => ({ value: g.id, label: g.name }))}
          />
        </div>
      </Modal>

      {picked && (
        <ManageManagersModal
          recruiter={picked}
          candidates={candidates}
          existing={effectiveManagers(picked)}
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
  onClose,
  onChanged,
}: {
  recruiter: RecruiterRow;
  candidates: CandidateUser[];
  existing: ManagerLink[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [picking, setPicking] = useState('');

  const existingIds = new Set(existing.map((m) => m.manager!.id));
  const available = candidates.filter((u) => !existingIds.has(u.id) && u.id !== recruiter.user?.id);

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
                    label: (u.full_name ?? u.email) + (u.role ? ` (${ROLE_LABEL[u.role]})` : ''),
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
