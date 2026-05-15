import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Layout } from '../components/Layout';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/Button';
import { Modal } from '../components/Modal';
import { SelectInput } from '../components/SelectInput';
import { Avatar } from '../components/TaskBits';
import { api } from '../services/api';
import { invalidate, useInvalidationListener } from '../hooks/useInvalidate';
import { Role, ROLE_LABEL } from '../types';
import clsx from 'clsx';

type Status = 'active' | 'inactive' | 'suspended' | 'pending_verification' | 'banned';

interface AdminUser {
  id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  role: Role;
  status: Status | null;
  status_reason: string | null;
  status_changed_at: string | null;
  must_change_password: boolean;
  last_login_at: string | null;
  last_seen_at: string | null;
  created_at: string;
  admin_notes: string | null;
  context?: {
    consultant?: any;
    recruiter?: any;
  };
}

interface AuditEvent {
  id: string;
  action: string;
  ip_address: string | null;
  user_agent: string | null;
  metadata: any;
  created_at: string;
  email: string | null;
}

const STATUS_PILL: Record<Status, string> = {
  active:               'bg-emerald-50 text-emerald-700 border-emerald-200',
  inactive:             'bg-slate-100  text-slate-600  border-slate-200',
  suspended:            'bg-amber-50   text-amber-800  border-amber-200',
  pending_verification: 'bg-sky-50     text-sky-700    border-sky-200',
  banned:               'bg-red-50     text-red-700    border-red-200',
};
const STATUS_DOT: Record<Status, string> = {
  active:               'bg-emerald-500',
  inactive:             'bg-slate-400',
  suspended:            'bg-amber-500',
  pending_verification: 'bg-sky-500',
  banned:               'bg-red-500',
};

export function AdminUserDetail() {
  const { id } = useParams<{ id: string }>();
  const [user, setUser] = useState<AdminUser | null>(null);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);

  // Status modal state — opening it pre-fills the current status so admins
  // see the existing reason and can edit, not blank.
  const [statusOpen, setStatusOpen] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<Status>('active');
  const [pendingReason, setPendingReason] = useState('');
  const [savingStatus, setSavingStatus] = useState(false);

  // Inline notes editor.
  const [notes, setNotes] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);

  // Bumped by the cross-page invalidation channel — see useInvalidate.ts.
  // Drops into the load effect's deps so a status change made on the list
  // page (or here) refetches the detail view without a hard reload.
  const [reloadTick, setReloadTick] = useState(0);
  useInvalidationListener('users', () => setReloadTick((n) => n + 1));

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      api.get<AdminUser>(`/admin/users/${id}`),
      api.get<AuditEvent[]>(`/admin/users/${id}/audit`),
    ]).then(([u, a]) => {
      if (cancelled) return;
      setUser(u.data);
      setAudit(a.data ?? []);
      setNotes(u.data.admin_notes ?? '');
    }).catch((e) => {
      if (cancelled) return;
      const status = e?.response?.status;
      if (status === 404) toast.error('User not found');
      else if (status === 403) toast.error('Admin access required');
      else toast.error(e?.response?.data?.error ?? 'Failed to load user');
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id, reloadTick]);

  function openStatusModal() {
    if (!user) return;
    setPendingStatus((user.status ?? 'active') as Status);
    setPendingReason(user.status_reason ?? '');
    setStatusOpen(true);
  }

  async function saveStatus() {
    if (!user || savingStatus) return;
    setSavingStatus(true);
    try {
      const { data } = await api.patch(`/admin/users/${user.id}/status`, {
        status: pendingStatus,
        reason: pendingReason || undefined,
      });
      // Merge the returned status fields into the local user copy.
      setUser({ ...user, ...data });
      toast.success(`Status set to ${pendingStatus.replace(/_/g, ' ')}`);
      setStatusOpen(false);
      // Refresh the audit log so the change appears immediately.
      const a = await api.get<AuditEvent[]>(`/admin/users/${user.id}/audit`);
      setAudit(a.data ?? []);
      // Notify sibling pages (AdminUsers list, DeactivatedAccounts) so
      // their data refetches and they don't show a stale status.
      invalidate('users');
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Status change failed');
    } finally {
      setSavingStatus(false);
    }
  }

  async function saveNotes() {
    if (!user || savingNotes) return;
    setSavingNotes(true);
    try {
      await api.patch(`/admin/users/${user.id}/notes`, { admin_notes: notes || null });
      toast.success('Notes saved');
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Save failed');
    } finally {
      setSavingNotes(false);
    }
  }

  async function sendReset() {
    if (!user) return;
    if (!confirm(`Send a password reset email to ${user.email}?`)) return;
    try {
      await api.post(`/admin/users/${user.id}/send-password-reset`);
      toast.success('Password reset email sent');
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Send failed');
    }
  }

  if (loading) {
    return <Layout title="Admin · User"><div className="text-sm text-slate-500">Loading…</div></Layout>;
  }
  if (!user) {
    return <Layout title="Admin · User"><div className="text-sm text-slate-500">User not available.</div></Layout>;
  }

  const status = (user.status ?? 'active') as Status;
  const isActive = status === 'active';

  return (
    <Layout
      title={user.full_name ?? user.email}
      crumbs={[
        { label: 'Workspace', to: '/dashboard' },
        { label: 'Admin' },
        { label: 'Users', to: '/admin/users' },
        { label: user.full_name ?? user.email },
      ]}
    >
      <PageHeader
        title={user.full_name ?? user.email}
        description={user.email}
        action={
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={sendReset}>Send password reset</Button>
            <Button onClick={openStatusModal}>Change status</Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Main column */}
        <div className="lg:col-span-2 space-y-5">
          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="flex items-start gap-4">
              <Avatar name={user.full_name} email={user.email} size={56} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-lg font-semibold text-slate-900 truncate">{user.full_name ?? user.email}</h2>
                  <span className={clsx(
                    'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium border',
                    STATUS_PILL[status],
                  )}>
                    <span className={clsx('w-1.5 h-1.5 rounded-full', STATUS_DOT[status])} />
                    {status.replace(/_/g, ' ')}
                  </span>
                </div>
                <div className="text-sm text-slate-500 mt-0.5">
                  <span className="text-[10px] font-semibold uppercase tracking-widest bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded mr-1.5">
                    {ROLE_LABEL[user.role] ?? user.role}
                  </span>
                  {user.email}
                </div>
                {user.status_reason && (
                  <p className="text-xs text-slate-600 mt-2 italic">
                    Status reason: <span className="text-slate-800">{user.status_reason}</span>
                  </p>
                )}
              </div>
              <Link to={`/users/${user.id}`} className="text-xs text-brand-700 hover:underline">
                Open full profile →
              </Link>
            </div>

            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3 mt-5 pt-5 border-t border-slate-100 text-sm">
              <Cell label="Joined" value={new Date(user.created_at).toLocaleDateString()} />
              <Cell label="Last login" value={user.last_login_at ? new Date(user.last_login_at).toLocaleString() : '—'} />
              <Cell label="Last seen" value={user.last_seen_at ? new Date(user.last_seen_at).toLocaleString() : '—'} />
              <Cell label="Verification"
                value={user.must_change_password
                  ? <span className="text-amber-700">Pending password</span>
                  : <span className="text-emerald-700">✓ Verified</span>} />
            </dl>

            {!isActive && (
              <div className="mt-4 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-900">
                This account is <strong className="capitalize">{status.replace(/_/g, ' ')}</strong> — sign-in is blocked
                and existing sessions have been revoked.
              </div>
            )}
          </div>

          {/* Role-specific context */}
          {user.context?.consultant && (
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-3">Consultant</div>
              <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3 text-sm">
                <Cell label="Primary skill" value={user.context.consultant.primary_skill ?? '—'} />
                <Cell label="Years experience" value={String(user.context.consultant.total_experience_years ?? '—')} />
                <Cell label="Visa" value={user.context.consultant.visa_status ?? '—'} />
                <Cell label="Location" value={user.context.consultant.current_location ?? '—'} />
                <Cell label="Marketing status" value={user.context.consultant.marketing_status ?? '—'} />
              </dl>
              {user.context.consultant.skills?.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {user.context.consultant.skills.map((s: string) => (
                    <span key={s} className="text-[11px] bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full">{s}</span>
                  ))}
                </div>
              )}
            </div>
          )}
          {user.context?.recruiter && (
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-3">Recruiter</div>
              <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3 text-sm">
                <Cell label="Team" value={user.context.recruiter.team ?? '—'} />
                <Cell label="Manager"
                  value={user.context.recruiter.manager?.full_name ?? user.context.recruiter.manager?.email ?? '—'} />
                <Cell label="Weekly target"
                  value={String(user.context.recruiter.target_submissions_per_week ?? '—')} />
              </dl>
            </div>
          )}

          {/* Audit timeline */}
          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-900">Activity</h3>
              <span className="text-xs text-slate-500">{audit.length} events</span>
            </div>
            {audit.length === 0 ? (
              <p className="text-sm italic text-slate-400">No audit events recorded.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {audit.slice(0, 50).map((a) => (
                  <li key={a.id} className="py-2.5 text-sm flex items-start gap-3">
                    <span className="text-[10px] font-mono text-slate-500 w-32 shrink-0 mt-0.5">
                      {new Date(a.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="font-medium text-slate-800">{a.action.replace(/_/g, ' ')}</span>
                      {a.ip_address && <span className="text-slate-500 text-xs"> · IP {a.ip_address}</span>}
                      {a.metadata && Object.keys(a.metadata).length > 0 && (
                        <pre className="text-[11px] text-slate-500 font-mono mt-0.5 truncate">
                          {JSON.stringify(a.metadata)}
                        </pre>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-5">
          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-2">Admin notes</div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Internal notes, never shown to the user"
              rows={6}
              className="w-full text-sm rounded-lg border border-slate-300 hover:border-slate-400 bg-white px-3 py-2 shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500 resize-none"
            />
            <div className="mt-2 flex justify-end">
              <Button size="sm" onClick={saveNotes} loading={savingNotes}>
                {savingNotes ? 'Saving' : 'Save notes'}
              </Button>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-2">Quick actions</div>
            <div className="space-y-2">
              <Button variant="secondary" className="w-full justify-start" onClick={sendReset}>
                Send password reset
              </Button>
              <Button variant={isActive ? 'danger' : 'primary'} className="w-full justify-start"
                onClick={openStatusModal}>
                {isActive ? 'Deactivate / suspend' : 'Reactivate'}
              </Button>
            </div>
          </div>
        </div>
      </div>

      <Modal
        open={statusOpen}
        onClose={() => setStatusOpen(false)}
        title="Change account status"
        description="Non-active statuses block sign-in immediately and revoke all sessions."
        footer={
          <>
            <Button variant="secondary" onClick={() => setStatusOpen(false)}>Cancel</Button>
            <Button onClick={saveStatus} loading={savingStatus}>{savingStatus ? 'Saving' : 'Apply'}</Button>
          </>
        }
      >
        <div className="space-y-3">
          <SelectInput
            label="Status"
            value={pendingStatus}
            onChange={(e) => setPendingStatus(e.target.value as Status)}
            options={[
              { value: 'active',               label: 'Active' },
              { value: 'inactive',             label: 'Inactive (login blocked)' },
              { value: 'suspended',            label: 'Suspended (login blocked, reversible)' },
              { value: 'pending_verification', label: 'Pending verification' },
              { value: 'banned',               label: 'Banned (login blocked, escalated)' },
            ]}
          />
          <label className="block">
            <span className="block text-xs font-medium text-slate-700 mb-1.5">Reason (optional)</span>
            <textarea
              rows={3}
              value={pendingReason}
              onChange={(e) => setPendingReason(e.target.value)}
              placeholder="Surfaces in the audit log"
              className="w-full rounded-lg border border-slate-300 hover:border-slate-400 bg-white px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
            />
          </label>
        </div>
      </Modal>
    </Layout>
  );
}

function Cell({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">{label}</div>
      <div className="text-sm text-slate-900 mt-0.5">{value}</div>
    </div>
  );
}
