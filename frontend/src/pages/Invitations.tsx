import { useEffect, useState, useCallback } from 'react';
import { Layout } from '../components/Layout';
import { DataTable } from '../components/DataTable';
import { StatusBadge } from '../components/StatusBadge';
import { Modal } from '../components/Modal';
import { FormInput } from '../components/FormInput';
import { SelectInput } from '../components/SelectInput';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/Button';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { invalidate } from '../hooks/useInvalidate';
import { ADMIN_TIER } from '../types';
import toast from 'react-hot-toast';

// Master role list for the invite dropdown. We gate SUPER_ADMIN at render
// time below — only an existing SUPER_ADMIN sees that option, matching the
// backend check in invitations.controller.ts that 403s otherwise.
const ALL_INVITE_OPTIONS = [
  { value: 'CONSULTANT', label: 'Consultant' },
  { value: 'RECRUITER', label: 'Recruiter' },
  { value: 'DEVELOPER', label: 'Developer' },
  { value: 'HR_MANAGER', label: 'HR Manager' },
  { value: 'MANAGER', label: 'Manager' },
  { value: 'DIRECTOR', label: 'Director' },
  { value: 'CTO', label: 'CTO' },
  { value: 'CEO', label: 'CEO' },
  { value: 'SUPER_ADMIN', label: 'Super admin' },
];

// Roles that require a parent in the hierarchy
const ROLES_NEEDING_PARENT = new Set([
  'CONSULTANT',
  'RECRUITER',
  'MANAGER',
  'HR_MANAGER',
  'DEVELOPER',
]);

type ParentOption = { id: string; full_name: string | null; email: string; role: string };

export function Invitations() {
  const { profile } = useAuth();
  const isAdmin = !!profile && (ADMIN_TIER as string[]).includes(profile.role);

  // Hide SUPER_ADMIN from the invite dropdown unless the inviter is itself
  // a SUPER_ADMIN — backend rejects the post otherwise.
  const ROLE_OPTIONS =
    profile?.role === 'SUPER_ADMIN'
      ? ALL_INVITE_OPTIONS
      : ALL_INVITE_OPTIONS.filter((o) => o.value !== 'SUPER_ADMIN');

  const [rows, setRows] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<{
    email: string;
    role: string;
    group_id: string;
    parent_user_id: string;
  }>({
    email: '',
    role: 'CONSULTANT',
    group_id: '',
    parent_user_id: '',
  });
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState<{ id: string; name: string; unique_group_id?: string }[]>(
    [],
  );

  // Parent resolution state
  const [parentOptions, setParentOptions] = useState<ParentOption[]>([]);
  const [autoParentId, setAutoParentId] = useState<string | null>(null); // null = no auto-parent
  const [autoParentResolved, setAutoParentResolved] = useState(false);
  const [manualOverride, setManualOverride] = useState(false);

  function load() {
    setLoading(true);
    api
      .get('/invitations')
      .then((r) => setRows(r.data ?? []))
      .catch((e) => toast.error(e?.response?.data?.error ?? 'Failed to load invitations'))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    api
      .get('/user-groups')
      .then((r) => setGroups(r.data ?? []))
      .catch(() => {});
  }, []);

  // Fetch available parents whenever the role changes
  const fetchParents = useCallback(
    async (role: string) => {
      if (!ROLES_NEEDING_PARENT.has(role)) {
        setParentOptions([]);
        setAutoParentId(null);
        setAutoParentResolved(true);
        setManualOverride(false);
        setForm((f) => ({ ...f, parent_user_id: '' }));
        return;
      }
      try {
        const r = await api.get<ParentOption[]>('/invitations/available-parents', {
          params: { invited_role: role },
        });
        const opts = r.data ?? [];
        setParentOptions(opts);

        // Auto-assign: if the current user is in the list, pre-select them
        const self = opts.find((o) => o.id === profile?.id);
        if (self) {
          setAutoParentId(self.id);
          setManualOverride(false);
          setForm((f) => ({ ...f, parent_user_id: self.id }));
        } else {
          setAutoParentId(null);
          setManualOverride(false);
          setForm((f) => ({ ...f, parent_user_id: opts.length === 1 ? opts[0].id : '' }));
        }
        setAutoParentResolved(true);
      } catch {
        setParentOptions([]);
        setAutoParentId(null);
        setAutoParentResolved(true);
      }
    },
    [profile?.id],
  );

  // Run when modal opens or role changes
  useEffect(() => {
    if (open) {
      setAutoParentResolved(false);
      fetchParents(form.role);
    }
  }, [open, form.role, fetchParents]);

  function handleRoleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const newRole = e.target.value;
    setManualOverride(false);
    setForm((f) => ({ ...f, role: newRole, parent_user_id: '' }));
  }

  async function send() {
    if (sending) return;
    if (!form.email) {
      toast.error('Email is required');
      return;
    }
    // Require parent if needed and not resolved
    if (ROLES_NEEDING_PARENT.has(form.role) && !form.parent_user_id) {
      toast.error('Please select a parent user for this role');
      return;
    }
    setSending(true);
    try {
      const payload: Record<string, unknown> = {
        email: form.email,
        role: form.role,
        group_id: form.group_id || null,
        parent_user_id: form.parent_user_id || null,
      };
      const r = await api.post('/invitations', payload);
      if (r.data?.email_sent) {
        toast.success('Invitation email sent');
      } else {
        toast(
          (t) => (
            <div className="space-y-1">
              <div className="font-medium">Invitation created, but email failed</div>
              <div className="text-xs text-muted">
                {r.data?.email_error ?? 'Unknown email error'}
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  copyLink(r.data.invite_url);
                  toast.dismiss(t.id);
                }}
                className="text-xs text-brand-700 hover:underline"
              >
                Copy invite link
              </Button>
            </div>
          ),
          { duration: 12000 },
        );
      }
      setOpen(false);
      setForm({ email: '', role: 'CONSULTANT', group_id: '', parent_user_id: '' });
      setManualOverride(false);
      load();
      invalidate('invitations');
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Something went wrong. Please try again.');
    } finally {
      setSending(false);
    }
  }

  async function revoke(id: string) {
    if (!confirm('Revoke this invitation?')) return;
    try {
      await api.post(`/invitations/${id}/revoke`);
      toast.success('Invitation revoked');
      load();
      invalidate('invitations');
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Revoke failed');
    }
  }

  async function copyLink(url: string) {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Invite link copied');
    } catch {
      window.prompt('Copy this invite link', url);
    }
  }

  // Parent field UI inside the modal
  function renderParentField() {
    if (!ROLES_NEEDING_PARENT.has(form.role)) return null;
    if (!autoParentResolved) {
      return <div className="text-xs text-muted py-1">Loading parent options…</div>;
    }

    // Auto-assigned to the inviter themselves
    if (autoParentId && !manualOverride) {
      const self = parentOptions.find((o) => o.id === autoParentId);
      return (
        <div className="flex items-center justify-between rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 px-3 py-2">
          <div>
            <span className="text-xs font-medium text-green-700 dark:text-green-400">
              Auto-assigned to you
            </span>
            <span className="ml-1 text-xs text-muted">
              ({self?.full_name ?? self?.email ?? ''} ·{' '}
              {form.role === 'CONSULTANT' ? 'RECRUITER' : 'MANAGER'})
            </span>
          </div>
          {isAdmin && (
            <button
              type="button"
              className="text-xs text-brand-600 hover:underline ml-2 shrink-0"
              onClick={() => {
                setManualOverride(true);
                setForm((f) => ({ ...f, parent_user_id: autoParentId }));
              }}
            >
              Change
            </button>
          )}
        </div>
      );
    }

    // No options available
    if (parentOptions.length === 0) {
      return (
        <div className="rounded-lg border border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-900/20 px-3 py-2 text-xs text-yellow-700 dark:text-yellow-400">
          No eligible parent users found. Invite a manager-tier user first, or an admin can
          override.
        </div>
      );
    }

    // Dropdown for manual/forced selection
    return (
      <SelectInput
        label={`Parent user *`}
        value={form.parent_user_id}
        onChange={(e) => setForm((f) => ({ ...f, parent_user_id: e.target.value }))}
        options={[
          { value: '', label: 'Select parent…' },
          ...parentOptions.map((o) => ({
            value: o.id,
            label: `${o.full_name ?? o.email} (${o.role})`,
          })),
        ]}
      />
    );
  }

  return (
    <Layout title="Invitations">
      <PageHeader
        title="Invitations"
        description="Send role-scoped invites by email. Recipients land on /invite/accept and set their own password."
        action={<Button onClick={() => setOpen(true)}>+ Invite user</Button>}
      />
      <DataTable
        loading={loading}
        empty="No invitations yet."
        columns={[
          { key: 'email', header: 'Email' },
          {
            key: 'role',
            header: 'Role',
            render: (r: any) => (
              <span className="text-[11px] font-medium bg-hover text-ink px-1.5 py-0.5 rounded">
                {r.role}
              </span>
            ),
          },
          {
            key: 'status',
            header: 'Status',
            render: (r: any) => <StatusBadge status={r.status} />,
          },
          {
            key: 'expires_at',
            header: 'Expires',
            hideOnMobile: true,
            render: (r: any) => (r.expires_at ? new Date(r.expires_at).toLocaleString() : '—'),
          },
          {
            key: 'actions',
            header: '',
            align: 'right',
            render: (r: any) =>
              r.status === 'PENDING' ? (
                <div className="flex items-center justify-end gap-1">
                  {r.invite_url && (
                    <Button size="sm" variant="ghost" onClick={() => copyLink(r.invite_url)}>
                      Copy link
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => revoke(r.id)}
                    className="text-red-600 dark:text-red-400 hover:text-red-700"
                  >
                    Revoke
                  </Button>
                </div>
              ) : null,
          },
        ]}
        rows={rows}
      />
      <Modal
        open={open}
        onClose={() => {
          setOpen(false);
          setManualOverride(false);
        }}
        title="Invite user"
        description="A welcome email goes out with a one-time setup link."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={send} loading={sending}>
              {sending ? 'Sending' : 'Send invite'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <FormInput
            label="Email *"
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
          <SelectInput
            label="Role"
            value={form.role}
            onChange={handleRoleChange}
            options={ROLE_OPTIONS}
          />
          {renderParentField()}
          <SelectInput
            label="Group"
            value={form.group_id}
            onChange={(e) => setForm({ ...form, group_id: e.target.value })}
            options={[
              { value: '', label: 'No Group' },
              ...groups.map((g) => ({
                value: g.id,
                label: g.unique_group_id ? `${g.name} (${g.unique_group_id})` : g.name,
              })),
            ]}
          />
        </div>
      </Modal>
    </Layout>
  );
}
