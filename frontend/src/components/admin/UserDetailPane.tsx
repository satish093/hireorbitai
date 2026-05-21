import { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Avatar } from '../TaskBits';
import { SkeletonCard } from '../Skeleton';
import { EmptyState } from '../EmptyState';
import { GroupBadge, RoleChip, StatusPill } from './UserBits';
import { useUserDetail } from './useUserDetail';
import { AUDIT_DOT, auditTone, relativeTime, statusOf, type GroupLite } from './types';

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

/**
 * Right-side slide-in detail pane for one user. Header + footer are pinned; the
 * body scrolls. This is the read-only core (identity + identity card + audit
 * timeline); quick actions, sessions, and the destructive footer are layered in
 * by later steps.
 */
export function UserDetailPane({
  userId,
  onClose,
  groupsById,
}: {
  userId: string;
  onClose: () => void;
  groupsById: Record<string, GroupLite>;
}) {
  const { user, audit, loading, error } = useUserDetail(userId);

  return (
    <div className="flex flex-col h-full min-h-0 bg-bg-elev">
      {/* Top bar (pinned) */}
      <div className="shrink-0 flex items-center gap-2 px-4 h-12 border-b border-border">
        <span className="text-[11px] font-mono text-muted">USR-{userId.slice(0, 8)}</span>
        {user && <StatusPill status={statusOf(user)} reason={user.status_reason} />}
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
    </div>
  );
}
