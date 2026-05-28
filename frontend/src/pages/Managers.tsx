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

export function Managers() {
  const { profile } = useAuth();
  const { groups } = useUserGroups();
  const canEditGroup = !!profile && (ADMIN_TIER as readonly string[]).includes(profile.role);

  const [rows, setRows] = useState<ManagerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [picked, setPicked] = useState<ManagerRow | null>(null);
  const [selectedGroup, setSelectedGroup] = useState('');
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
  }

  async function saveGroup() {
    if (!picked) return;
    setSaving(true);
    try {
      await api.patch(`/admin/users/${picked.id}/group`, {
        group_id: selectedGroup || null,
      });
      toast.success('Group updated');
      invalidateUserGroupsCache();
      setPicked(null);
      load();
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to update group');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Layout title="Managers">
      <PageHeader
        title="Managers"
        description="Users with role Manager or HR Manager. Admin tier can reassign their group."
      />
      <DataTable
        rows={rows}
        loading={loading}
        empty="No managers found."
        columns={[
          {
            key: 'name',
            header: 'Name',
            render: (m: ManagerRow) => (
              <Link
                to={`/users/${m.id}`}
                className="inline-flex items-center gap-2 hover:bg-hover rounded-md -mx-1 px-1 py-0.5"
              >
                <Avatar name={m.full_name} email={m.email} size={26} />
                <div className="leading-tight">
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
            render: (m: ManagerRow) => (
              <span className="text-xs font-medium text-ink">{ROLE_LABEL[m.role] ?? m.role}</span>
            ),
          },
          {
            key: 'group',
            header: 'Group',
            render: (m: ManagerRow) => <GroupBadge groupId={m.group_id ?? null} />,
          },
          {
            key: 'recruiters',
            header: 'Recruiters',
            align: 'right',
            hideOnMobile: true,
            render: (m: ManagerRow) =>
              m.recruiter_count > 0 ? (
                <Link
                  to={`/recruiters`}
                  className="inline-flex items-center justify-center min-w-[1.75rem] rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700 hover:bg-brand-100"
                  title={`${m.recruiter_count} recruiter${m.recruiter_count === 1 ? '' : 's'}`}
                >
                  {m.recruiter_count}
                </Link>
              ) : (
                <span className="text-xs text-muted">0</span>
              ),
          },
          {
            key: 'status',
            header: 'Status',
            hideOnMobile: true,
            render: (m: ManagerRow) => (
              <span
                className={
                  m.status === 'active' ? 'text-xs text-emerald-700' : 'text-xs text-muted italic'
                }
              >
                {m.status ?? 'active'}
              </span>
            ),
          },
          ...(canEditGroup
            ? [
                {
                  key: 'actions',
                  header: '',
                  align: 'right' as const,
                  render: (m: ManagerRow) => (
                    <Button size="sm" variant="ghost" onClick={() => openGroupEdit(m)}>
                      Group
                    </Button>
                  ),
                },
              ]
            : []),
        ]}
      />

      <Modal
        open={!!picked}
        onClose={() => setPicked(null)}
        title={`Move ${picked?.full_name ?? picked?.email ?? 'manager'} to a group`}
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
    </Layout>
  );
}
