import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { DataTable } from '../components/DataTable';
import { Modal } from '../components/Modal';
import { Avatar } from '../components/TaskBits';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/Button';
import { SelectInput } from '../components/SelectInput';
import { GroupBadge } from '../components/GroupBadge';
import { api } from '../services/api';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { Role, ROLE_LABEL, MANAGER_TIER } from '../types';

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
  const [rows, setRows] = useState<RecruiterRow[]>([]);
  const [candidates, setCandidates] = useState<CandidateUser[]>([]);
  const [picked, setPicked] = useState<RecruiterRow | null>(null);
  const [loading, setLoading] = useState(true);

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
                  className="inline-flex items-center gap-2 hover:bg-slate-50 rounded-md -mx-1 px-1 py-0.5"
                >
                  <Avatar name={r.user?.full_name} email={r.user?.email} size={26} />
                  <div className="text-sm font-medium text-slate-900 hover:underline">
                    {r.user?.full_name ?? r.user?.email ?? '—'}
                  </div>
                </Link>
              ) : (
                <div className="inline-flex items-center gap-2">
                  <Avatar name={r.user?.full_name} email={r.user?.email} size={26} />
                  <div className="text-sm font-medium text-slate-900">
                    {r.user?.full_name ?? r.user?.email ?? '—'}
                  </div>
                </div>
              ),
          },
          { key: 'team', header: 'Team' },
          {
            key: 'group',
            header: 'Group',
            render: (r: RecruiterRow) => <GroupBadge groupId={r.user?.group_id ?? null} />,
          },
          {
            key: 'managers',
            header: 'Reports to',
            render: (r: RecruiterRow) => {
              const mgrs = effectiveManagers(r);
              if (mgrs.length === 0)
                return <span className="text-xs italic text-slate-400">None</span>;
              return (
                <div className="flex flex-wrap gap-1.5">
                  {mgrs.map((m) => (
                    <span
                      key={m.manager!.id}
                      className={clsx(
                        'inline-flex items-center gap-1.5 text-xs rounded-full px-2 py-0.5 border',
                        m.is_primary
                          ? 'bg-brand-50 text-brand-700 border-brand-200'
                          : 'bg-slate-50 text-slate-700 border-slate-200',
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
            render: (r: RecruiterRow) => r.target_submissions_per_week ?? '—',
          },
          {
            key: 'actions',
            header: '',
            align: 'right',
            render: (r: RecruiterRow) => (
              <Button size="sm" variant="ghost" onClick={() => setPicked(r)}>
                Manage supervisors
              </Button>
            ),
          },
        ]}
      />

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
        <p className="text-sm text-slate-500">
          A recruiter can report to multiple managers / directors. The{' '}
          <span className="font-medium text-brand-700">★ primary</span> supervisor appears as their
          default in reports.
        </p>

        {/* Existing managers */}
        <div>
          <h3 className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">
            Current supervisors
          </h3>
          {existing.length === 0 ? (
            <p className="text-sm italic text-slate-400">None assigned yet</p>
          ) : (
            <div className="space-y-1.5">
              {existing.map((m) => (
                <div
                  key={m.manager!.id}
                  className="flex items-center gap-2 border border-slate-200 rounded-lg px-3 py-2"
                >
                  <Avatar name={m.manager!.full_name} email={m.manager!.email} size={28} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-slate-900 truncate">
                      {m.manager!.full_name ?? m.manager!.email}
                    </div>
                    <div className="text-[10px] uppercase tracking-wider text-slate-500">
                      {m.manager!.role && ROLE_LABEL[m.manager!.role]}
                      {m.is_primary && <span className="ml-2 text-brand-700">★ Primary</span>}
                    </div>
                  </div>
                  {!m.is_primary && (
                    <button
                      onClick={() => makePrimary(m.manager!.id)}
                      disabled={busy === 'primary-' + m.manager!.id}
                      className="text-xs text-brand-700 hover:underline disabled:opacity-50"
                    >
                      Make primary
                    </button>
                  )}
                  <button
                    onClick={() => remove(m.manager!.id)}
                    disabled={busy === 'remove-' + m.manager!.id}
                    className="text-xs text-red-600 hover:underline disabled:opacity-50"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Add a new manager */}
        <div>
          <h3 className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">
            Add a supervisor
          </h3>
          {available.length === 0 ? (
            <p className="text-sm italic text-slate-400">No more eligible supervisors available.</p>
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
