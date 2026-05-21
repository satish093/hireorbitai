import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { DataTable } from '../components/DataTable';
import { Modal } from '../components/Modal';
import { SelectInput } from '../components/SelectInput';
import { Avatar } from '../components/TaskBits';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/Button';
import { GroupBadge } from '../components/GroupBadge';
import { api } from '../services/api';
import toast from 'react-hot-toast';
import clsx from 'clsx';

interface ConsultantRow {
  id: string;
  primary_skill?: string | null;
  visa_status?: string | null;
  total_experience_years?: number | null;
  marketing_status: 'ACTIVE' | 'PAUSED' | 'PLACED';
  current_location?: string | null;
  recruiter_id?: string | null;
  user?: {
    id?: string;
    full_name?: string | null;
    email?: string | null;
    group_id?: string | null;
  } | null;
  recruiter?: {
    id: string;
    team?: string | null;
    user?: {
      id?: string;
      full_name?: string | null;
      email?: string | null;
      group_id?: string | null;
    } | null;
  } | null;
}

interface RecruiterRow {
  id: string;
  team?: string | null;
  user?: {
    id?: string;
    full_name?: string | null;
    email?: string | null;
    group_id?: string | null;
  } | null;
}

const STATUS_TONE: Record<string, string> = {
  ACTIVE:
    'bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30 focus:ring-emerald-500/30',
  PAUSED:
    'bg-amber-50 dark:bg-amber-500/15  text-amber-800 dark:text-amber-300  border-amber-200 dark:border-amber-500/30  focus:ring-amber-500/30',
  PLACED:
    'bg-blue-50 dark:bg-blue-500/15   text-blue-700 dark:text-blue-300   border-blue-200 dark:border-blue-500/30   focus:ring-blue-500/30',
};

export function Consultants() {
  const [rows, setRows] = useState<ConsultantRow[]>([]);
  const [recruiters, setRecruiters] = useState<RecruiterRow[]>([]);
  const [picked, setPicked] = useState<ConsultantRow | null>(null);
  const [selectedRecruiter, setSelectedRecruiter] = useState('');
  const [saving, setSaving] = useState(false);
  const [listLoading, setListLoading] = useState(true);

  function load() {
    setListLoading(true);
    api
      .get('/consultants')
      .then((r) => setRows(r.data ?? []))
      .catch((e) => toast.error(e?.response?.data?.error ?? 'Failed to load consultants'))
      .finally(() => setListLoading(false));
  }

  useEffect(() => {
    let cancelled = false;
    load();
    api
      .get('/recruiters')
      .then((r) => {
        if (!cancelled) setRecruiters(r.data ?? []);
      })
      .catch((e) => {
        if (!cancelled) toast.error(e?.response?.data?.error ?? 'Failed to load recruiters');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function openAssign(c: ConsultantRow) {
    setPicked(c);
    setSelectedRecruiter(c.recruiter_id ?? '');
  }

  async function save() {
    if (!picked) return;
    if (!selectedRecruiter) {
      toast.error('Pick a recruiter');
      return;
    }
    if (selectedRecruiter === picked.recruiter_id) {
      setPicked(null);
      return;
    }
    setSaving(true);
    try {
      await api.post(`/consultants/${picked.id}/assign-recruiter`, {
        recruiter_id: selectedRecruiter,
      });
      toast.success('Recruiter assigned');
      setPicked(null);
      load();
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to assign');
    } finally {
      setSaving(false);
    }
  }

  async function setStatus(id: string, marketing_status: string) {
    try {
      await api.post(`/consultants/${id}/marketing-status`, { marketing_status });
      load();
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Something went wrong. Please try again.');
    }
  }

  return (
    <Layout title="Consultants">
      <PageHeader
        title="Consultants"
        description="Active bench. Assign recruiters, set marketing status, and open profiles for full context."
      />
      <DataTable
        rows={rows}
        loading={listLoading}
        empty="No consultants yet."
        columns={[
          {
            key: 'name',
            header: 'Name',
            render: (c: ConsultantRow) =>
              c.user?.id ? (
                <Link
                  to={`/users/${c.user.id}`}
                  className="inline-flex items-center gap-2 hover:bg-hover rounded-md -mx-1 px-1 py-0.5"
                >
                  <Avatar name={c.user?.full_name} email={c.user?.email} size={26} />
                  <div className="leading-tight">
                    <div className="text-sm font-medium text-ink hover:underline">
                      {c.user?.full_name ?? c.user?.email ?? '—'}
                    </div>
                    {c.current_location && (
                      <div className="text-[11px] text-muted">{c.current_location}</div>
                    )}
                  </div>
                </Link>
              ) : (
                <div className="inline-flex items-center gap-2">
                  <Avatar name={c.user?.full_name} email={c.user?.email} size={26} />
                  <div className="leading-tight">
                    <div className="text-sm font-medium text-ink">
                      {c.user?.full_name ?? c.user?.email ?? '—'}
                    </div>
                    {c.current_location && (
                      <div className="text-[11px] text-muted">{c.current_location}</div>
                    )}
                  </div>
                </div>
              ),
          },
          {
            key: 'group',
            header: 'Group',
            render: (c: ConsultantRow) => <GroupBadge groupId={c.user?.group_id ?? null} />,
          },
          { key: 'primary_skill', header: 'Primary skill' },
          { key: 'visa_status', header: 'Visa' },
          {
            key: 'experience',
            header: 'Exp',
            render: (c: ConsultantRow) => `${c.total_experience_years ?? 0} yrs`,
          },
          {
            key: 'recruiter',
            header: 'Recruiter',
            render: (c: ConsultantRow) =>
              c.recruiter ? (
                <div className="inline-flex items-center gap-1.5">
                  <Avatar
                    name={c.recruiter.user?.full_name}
                    email={c.recruiter.user?.email}
                    size={20}
                  />
                  <div className="leading-tight">
                    <div className="text-sm text-ink">
                      {c.recruiter.user?.full_name ?? c.recruiter.user?.email ?? '—'}
                    </div>
                    {c.recruiter.team && (
                      <div className="text-[11px] text-muted">{c.recruiter.team}</div>
                    )}
                  </div>
                </div>
              ) : (
                <span className="text-xs italic text-muted">Unassigned</span>
              ),
          },
          {
            key: 'status',
            header: 'Status',
            render: (c: ConsultantRow) => (
              <select
                value={c.marketing_status}
                onChange={(e) => setStatus(c.id, e.target.value)}
                aria-label="Marketing status"
                className={clsx(
                  'appearance-none text-[11px] font-medium pl-2.5 pr-6 py-1 rounded-full border bg-no-repeat bg-[length:14px] bg-[position:right_4px_center] cursor-pointer focus:outline-none focus:ring-2 transition',
                  STATUS_TONE[c.marketing_status],
                )}
                style={{
                  backgroundImage:
                    'url("data:image/svg+xml;utf8,<svg xmlns=%27http://www.w3.org/2000/svg%27 width=%2710%27 height=%276%27 viewBox=%270 0 10 6%27 fill=%27none%27 stroke=%27currentColor%27 stroke-width=%271.5%27><path d=%27M1 1l4 4 4-4%27/></svg>")',
                }}
              >
                <option value="ACTIVE">Active</option>
                <option value="PAUSED">Paused</option>
                <option value="PLACED">Placed</option>
              </select>
            ),
          },
          {
            key: 'actions',
            header: '',
            align: 'right',
            render: (c: ConsultantRow) => (
              <Button size="sm" variant="ghost" onClick={() => openAssign(c)}>
                {c.recruiter ? 'Reassign' : 'Assign'}
              </Button>
            ),
          },
        ]}
      />

      <Modal
        open={!!picked}
        onClose={() => setPicked(null)}
        title={
          picked?.recruiter
            ? `Reassign ${picked.user?.full_name ?? 'consultant'}`
            : `Assign recruiter`
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setPicked(null)}>
              Cancel
            </Button>
            <Button
              onClick={save}
              loading={saving}
              disabled={!selectedRecruiter || selectedRecruiter === picked?.recruiter_id}
            >
              {saving ? 'Saving' : 'Save assignment'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {picked?.recruiter && (
            <div className="text-xs text-muted">
              Currently assigned to{' '}
              <span className="font-medium text-ink">
                {picked.recruiter.user?.full_name ?? picked.recruiter.user?.email}
              </span>
              .
            </div>
          )}
          <SelectInput
            label="Recruiter"
            placeholder="Select a recruiter…"
            value={selectedRecruiter}
            onChange={(e) => setSelectedRecruiter(e.target.value)}
            options={recruiters.map((r) => ({
              value: r.id,
              label: `${r.user?.full_name ?? r.user?.email ?? r.id}${r.team ? ' · ' + r.team : ''}`,
            }))}
          />
        </div>
      </Modal>
    </Layout>
  );
}
