import { ReactNode, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../../services/api';
import { setSession } from '../../services/session';
import { invalidate } from '../../hooks/useInvalidate';
import { Avatar } from '../TaskBits';
import { Button } from '../Button';
import { SelectInput } from '../SelectInput';
import { SkeletonCard } from '../Skeleton';
import { EmptyState } from '../EmptyState';
import { GroupBadge, RoleChip, StatusPill } from './UserBits';
import { ConfirmDialog, type ConfirmSpec } from './ConfirmDialog';
import { useUserDetail } from './useUserDetail';
import { AUDIT_DOT, auditTone, relativeTime, statusOf, type GroupLite, type Status } from './types';

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="text-[11px] uppercase tracking-wider text-muted shrink-0">{label}</span>
      <span className="text-sm text-ink text-right min-w-0 truncate">{value}</span>
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="text-[11px] font-mono uppercase tracking-wider text-muted mb-2">{children}</div>
  );
}

function QuickAction({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="h-9 rounded-lg border border-border bg-surface text-sm text-ink hover:bg-hover disabled:opacity-40 disabled:cursor-not-allowed press"
    >
      {label}
    </button>
  );
}

/**
 * Right-side slide-in detail pane for one user. Pinned header + destructive
 * footer, scrolling body. Every mutating action is confirmed via ConfirmDialog
 * (named explicitly). All lifecycle changes funnel through the existing
 * /status endpoint so audit logging stays consistent.
 */
export function UserDetailPane({
  userId,
  onClose,
  groups,
  me,
  onChanged,
}: {
  userId: string;
  onClose: () => void;
  groups: GroupLite[];
  me: { id: string } | null;
  onChanged: () => void;
}) {
  const { user, audit, loading, error, reload, setUser } = useUserDetail(userId);
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);

  const groupsById = useMemo(() => {
    const m: Record<string, GroupLite> = {};
    for (const g of groups) m[g.id] = g;
    return m;
  }, [groups]);

  // Local editors for group + admin notes (preserved from the old detail page).
  const [groupId, setGroupId] = useState('');
  const [notes, setNotes] = useState('');
  const [savingGroup, setSavingGroup] = useState(false);
  const [savingNotes, setSavingNotes] = useState(false);
  useEffect(() => {
    setGroupId(user?.group_id ?? '');
    setNotes(user?.admin_notes ?? '');
  }, [user?.id, user?.group_id, user?.admin_notes]);

  const isSelf = !!me && me.id === userId;
  const name = user?.full_name ?? user?.email ?? 'this user';
  const status = user ? statusOf(user) : 'active';

  function afterMutation() {
    reload();
    onChanged();
    invalidate('users');
  }

  async function setStatus(next: Status, label: string, tone: 'danger' | 'default') {
    setConfirm({
      title: `${label} ${name}?`,
      message:
        next === 'active' ? (
          <>
            Reactivate <strong className="text-ink">{name}</strong>? They’ll be able to sign in
            again.
          </>
        ) : (
          <>
            {label} <strong className="text-ink">{name}</strong>? Sign-in is blocked immediately and
            all active sessions are revoked.
          </>
        ),
      confirmLabel: label,
      tone,
      run: async () => {
        await api.patch(`/admin/users/${userId}/status`, { status: next });
        toast.success(`${name} ${next === 'active' ? 'reactivated' : label.toLowerCase() + 'ed'}`);
        afterMutation();
      },
    });
  }

  function quickReset() {
    setConfirm({
      title: `Send password reset to ${name}?`,
      message: (
        <>
          Email a password-reset link to <strong className="text-ink">{user?.email}</strong>.
        </>
      ),
      confirmLabel: 'Send reset',
      run: async () => {
        await api.post(`/admin/users/${userId}/send-password-reset`);
        toast.success('Password reset email sent');
      },
    });
  }

  function quickForcePwd() {
    setConfirm({
      title: `Force ${name} to change password?`,
      message: (
        <>
          <strong className="text-ink">{name}</strong> will be signed out everywhere and required to
          set a new password on next sign-in.
        </>
      ),
      confirmLabel: 'Force change',
      tone: 'danger',
      run: async () => {
        await api.post(`/admin/users/${userId}/force-password-change`);
        toast.success('User must change password on next sign-in');
        afterMutation();
      },
    });
  }

  function quickEndSessions() {
    setConfirm({
      title: `End all sessions for ${name}?`,
      message: (
        <>
          Revoke every active session for <strong className="text-ink">{name}</strong>. They’ll need
          to sign in again.
        </>
      ),
      confirmLabel: 'End sessions',
      tone: 'danger',
      run: async () => {
        await api.delete(`/admin/users/${userId}/sessions`);
        toast.success('All sessions ended');
        afterMutation();
      },
    });
  }

  function quickImpersonate() {
    setConfirm({
      title: `Impersonate ${name}?`,
      message: (
        <>
          You’ll be signed in as <strong className="text-ink">{name}</strong> in this browser. This
          is audited. Sign out to return to your own account.
        </>
      ),
      confirmLabel: 'Impersonate',
      run: async () => {
        const { data } = await api.post(`/admin/users/${userId}/impersonate`);
        setSession({
          access_token: data.access_token,
          refresh_token: data.refresh_token,
          expires_at: data.expires_at,
          user: data.user,
        });
        toast.success(`Now impersonating ${name}`);
        window.location.assign('/dashboard');
      },
    });
  }

  async function saveGroup() {
    if (!user || savingGroup) return;
    setSavingGroup(true);
    try {
      const { data } = await api.patch(`/admin/users/${user.id}/group`, {
        group_id: groupId || null,
      });
      setUser({ ...user, group_id: data.group_id ?? null });
      toast.success(groupId ? 'Group updated' : 'Removed from group');
      onChanged();
      invalidate('users');
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Group change failed');
    } finally {
      setSavingGroup(false);
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

  return (
    <div className="flex flex-col h-full min-h-0 bg-bg-elev">
      {/* Top bar (pinned) */}
      <div className="shrink-0 flex items-center gap-2 px-4 h-12 border-b border-border">
        <span className="text-[11px] font-mono text-muted">USR-{userId.slice(0, 8)}</span>
        {user && <StatusPill status={status} reason={user.status_reason} />}
        <div className="ml-auto flex items-center gap-1">
          {user && (
            <Link
              to={`/users/${user.id}`}
              className="w-8 h-8 grid place-items-center rounded-lg text-muted hover:text-ink hover:bg-hover"
              title="Open full profile"
            >
              ↗
            </Link>
          )}
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 grid place-items-center rounded-lg text-muted hover:text-ink hover:bg-hover"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Body (scrolls) */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-5">
        {loading ? (
          <SkeletonCard lines={6} />
        ) : error || !user ? (
          <EmptyState compact icon="⚠️" title={error ?? 'User not available'} />
        ) : (
          <>
            {/* Identity block */}
            <div className="flex items-start gap-3">
              <Avatar name={user.full_name} email={user.email} size={48} />
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-semibold text-ink leading-tight truncate">
                  {user.full_name ?? user.email}
                </h2>
                <div className="text-[12px] text-muted font-mono truncate">{user.email}</div>
                <div className="flex flex-wrap items-center gap-1.5 mt-2">
                  <RoleChip role={user.role} />
                  <GroupBadge group={user.group_id ? groupsById[user.group_id] : null} />
                </div>
              </div>
            </div>

            {user.status_reason && (
              <div className="text-xs text-muted bg-bg-sunken rounded-lg px-3 py-2">
                Status reason: <span className="text-ink">{user.status_reason}</span>
              </div>
            )}

            {/* Quick actions (2x2) */}
            <div>
              <SectionLabel>Quick actions</SectionLabel>
              <div className="grid grid-cols-2 gap-2">
                <QuickAction label="Send password reset" onClick={quickReset} />
                <QuickAction
                  label="Force password change"
                  onClick={quickForcePwd}
                  disabled={isSelf}
                />
                <QuickAction label="End sessions" onClick={quickEndSessions} disabled={isSelf} />
                <QuickAction label="Impersonate" onClick={quickImpersonate} disabled={isSelf} />
              </div>
            </div>

            {/* Identity card */}
            <div className="rounded-xl border border-border bg-surface px-4 py-2 divide-y divide-border">
              <Field label="Role" value={user.role} />
              <Field
                label="Group"
                value={user.group_id ? (groupsById[user.group_id]?.name ?? '—') : 'No group'}
              />
              <Field label="Invited" value={new Date(user.created_at).toLocaleDateString()} />
              <Field
                label="Last sign-in"
                value={user.last_login_at ? relativeTime(user.last_login_at) : 'Never'}
              />
              <Field
                label="Verification"
                value={
                  user.must_change_password ? (
                    <span className="text-warn">Pending password</span>
                  ) : (
                    <span className="text-success">Verified</span>
                  )
                }
              />
              <Field label="Sessions" value={String(user.session_count ?? 0)} />
            </div>

            {/* Admin: group + notes */}
            <div>
              <SectionLabel>Admin</SectionLabel>
              <div className="space-y-3">
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <SelectInput
                      label="Group"
                      value={groupId}
                      onChange={(e) => setGroupId(e.target.value)}
                      options={[
                        { value: '', label: 'No group' },
                        ...groups.map((g) => ({ value: g.id, label: g.name })),
                      ]}
                    />
                  </div>
                  <Button
                    size="sm"
                    onClick={saveGroup}
                    loading={savingGroup}
                    disabled={groupId === (user.group_id ?? '')}
                  >
                    Save
                  </Button>
                </div>
                <div>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={3}
                    placeholder="Admin notes — never shown to the user"
                    className="w-full text-sm rounded-lg border border-border bg-surface px-3 py-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:border-accent resize-none"
                  />
                  <div className="mt-1.5 flex justify-end">
                    <Button size="sm" variant="secondary" onClick={saveNotes} loading={savingNotes}>
                      Save notes
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            {/* Audit timeline */}
            <div>
              <SectionLabel>Activity · last 14d</SectionLabel>
              {audit.length === 0 ? (
                <EmptyState compact icon="🕒" title="No recent activity" />
              ) : (
                <ul className="space-y-2.5">
                  {audit.slice(0, 20).map((a) => (
                    <li key={a.id} className="flex items-start gap-2.5">
                      <span
                        className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${AUDIT_DOT[auditTone(a.action)]}`}
                        aria-hidden="true"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm text-ink">{a.action.replace(/_/g, ' ')}</div>
                        <div className="text-[11px] text-muted font-mono">
                          {new Date(a.created_at).toLocaleString([], {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                          {a.ip_address && ` · ${a.ip_address}`}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>

      {/* Destructive footer (pinned) */}
      {user && !isSelf && (
        <div className="shrink-0 border-t border-border px-4 py-3 flex items-center gap-2">
          {status === 'active' ? (
            <>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setStatus('suspended', 'Suspend', 'default')}
              >
                Suspend
              </Button>
              <button
                onClick={() => setStatus('inactive', 'Deactivate', 'danger')}
                className="h-9 px-3 rounded-lg text-sm text-danger hover:bg-danger-soft press"
              >
                Deactivate
              </button>
              <Button
                variant="danger"
                size="sm"
                className="ml-auto"
                onClick={() => setStatus('banned', 'Ban', 'danger')}
              >
                Ban
              </Button>
            </>
          ) : (
            <Button
              variant="primary"
              size="sm"
              onClick={() => setStatus('active', 'Reactivate', 'default')}
            >
              Reactivate
            </Button>
          )}
        </div>
      )}

      <ConfirmDialog spec={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
