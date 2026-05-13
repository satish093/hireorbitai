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
import toast from 'react-hot-toast';

const ROLE_OPTIONS = [
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
  const [rows, setRows] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ email: '', role: 'CONSULTANT' });
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    api.get('/invitations')
      .then((r) => setRows(r.data ?? []))
      .catch((e) => toast.error(e?.response?.data?.error ?? 'Failed to load invitations'))
      .finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, []);

  async function send() {
    if (sending) return;
    if (!form.email) { toast.error('Email is required'); return; }
    setSending(true);
    try {
      const r = await api.post('/invitations', form);
      if (r.data?.email_sent) {
        toast.success('Invitation email sent');
      } else {
        toast(
          (t) => (
            <div className="space-y-1">
              <div className="font-medium">Invitation created, but email failed</div>
              <div className="text-xs text-slate-600">{r.data?.email_error ?? 'Unknown email error'}</div>
              <button
                onClick={() => { copyLink(r.data.invite_url); toast.dismiss(t.id); }}
                className="text-xs text-brand-700 hover:underline"
              >Copy invite link</button>
            </div>
          ),
          { duration: 12000 }
        );
      }
      setOpen(false); setForm({ email: '', role: 'CONSULTANT' }); load();
    } catch (e: any) { toast.error(e?.response?.data?.error ?? 'Failed'); }
    finally { setSending(false); }
  }

  async function revoke(id: string) {
    if (!confirm('Revoke this invitation?')) return;
    try {
      await api.post(`/invitations/${id}/revoke`);
      toast.success('Invitation revoked');
      load();
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
          { key: 'role', header: 'Role', render: (r: any) =>
            <span className="text-[11px] font-medium bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded">{r.role}</span>
          },
          { key: 'status', header: 'Status', render: (r: any) => <StatusBadge status={r.status} /> },
          { key: 'expires_at', header: 'Expires', render: (r: any) => r.expires_at ? new Date(r.expires_at).toLocaleString() : '—' },
          { key: 'actions', header: '', align: 'right', render: (r: any) =>
            r.status === 'PENDING'
              ? (
                <div className="flex items-center justify-end gap-1">
                  {r.invite_url && (
                    <Button size="sm" variant="ghost" onClick={() => copyLink(r.invite_url)}>Copy link</Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => revoke(r.id)} className="text-red-600 hover:text-red-700">Revoke</Button>
                </div>
              )
              : null,
          },
        ]}
        rows={rows}
      />
      <Modal open={open} onClose={() => setOpen(false)} title="Invite user"
        description="A welcome email goes out with a one-time setup link."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={send} loading={sending}>{sending ? 'Sending' : 'Send invite'}</Button>
          </>
        }>
        <div className="space-y-3">
          <FormInput label="Email *" type="email" value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <SelectInput label="Role" value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value })}
            options={ROLE_OPTIONS}
          />
        </div>
      </Modal>
    </Layout>
  );
}
