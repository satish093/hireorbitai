import { useEffect, useState } from 'react';
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

export function Invitations() {
  const { profile } = useAuth();
  // Hide SUPER_ADMIN from the invite dropdown unless the inviter is itself
  // a SUPER_ADMIN — backend rejects the post otherwise (see
  // invitations.controller.ts), so showing it would just produce a
  // confusing 403 on submit.
  const ROLE_OPTIONS =
    profile?.role === 'SUPER_ADMIN'
      ? ALL_INVITE_OPTIONS
      : ALL_INVITE_OPTIONS.filter((o) => o.value !== 'SUPER_ADMIN');

  const [rows, setRows] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<{ email: string; role: string; group_id: string }>({
    email: '',
    role: 'CONSULTANT',
    group_id: '', // '' == No Group; converted to null at send-time
  });
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState<{ id: string; name: string; unique_group_id?: string }[]>(
    [],
  );

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
    // Fetch groups once for the dropdown. Failure is non-fatal — the dropdown
    // just shows "No Group" as the only option, matching the previous behavior
    // before this feature existed.
    api
      .get('/user-groups')
      .then((r) => setGroups(r.data ?? []))
      .catch(() => {});
  }, []);

  async function send() {
    if (sending) return;
    if (!form.email) {
      toast.error('Email is required');
      return;
    }
    setSending(true);
    try {
      const payload = {
        email: form.email,
        role: form.role,
        group_id: form.group_id || null,
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
              <button
                onClick={() => {
                  copyLink(r.data.invite_url);
                  toast.dismiss(t.id);
                }}
                className="text-xs text-brand-700 hover:underline"
              >
                Copy invite link
              </button>
            </div>
          ),
          { duration: 12000 },
        );
      }
      setOpen(false);
      setForm({ email: '', role: 'CONSULTANT', group_id: '' });
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
        onClose={() => setOpen(false)}
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
            onChange={(e) => setForm({ ...form, role: e.target.value })}
            options={ROLE_OPTIONS}
          />
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
