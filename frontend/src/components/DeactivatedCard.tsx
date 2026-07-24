import { Avatar } from './TaskBits';
import { GroupBadge } from './GroupBadge';
import { Button } from './Button';
import { ROLE_LABEL, type Role } from '../types';

type Status = 'active' | 'inactive' | 'suspended' | 'pending_verification' | 'banned';

interface DeactivatedCardRow {
  id: string;
  email: string;
  full_name: string | null;
  role: Role;
  is_active?: boolean;
  status: Status | null;
  status_reason: string | null;
  status_changed_at: string | null;
  last_seen_at?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
  group_id: string | null;
}

const STATUS_COLORS: Record<Status, { bg: string; text: string }> = {
  active: { bg: 'var(--success-soft)', text: 'var(--success)' },
  inactive: { bg: 'var(--hover)', text: 'var(--muted)' },
  suspended: { bg: 'var(--warn-soft)', text: 'var(--warn)' },
  pending_verification: { bg: 'var(--accent-soft)', text: 'var(--accent)' },
  banned: { bg: 'var(--danger-soft)', text: 'var(--danger)' },
};

interface Props {
  row: DeactivatedCardRow;
  busy: boolean;
  onReactivate: (row: DeactivatedCardRow) => void;
  onOpenProfile: (id: string) => void;
}

/**
 * Mobile entity card for a deactivated account (< 768px).
 * Pairs with the desktop DataTable row on DeactivatedAccounts page.
 */
export function DeactivatedCard({ row, busy, onReactivate, onOpenProfile }: Props) {
  const name = row.full_name ?? row.email;
  const roleLabel = ROLE_LABEL[row.role] ?? row.role;
  const status: Status = row.status ?? 'inactive';
  const colors = STATUS_COLORS[status] ?? STATUS_COLORS.inactive;
  const changedAt = row.status_changed_at
    ? new Date(row.status_changed_at).toLocaleDateString()
    : null;

  return (
    <div
      className="p-4 rounded-xl"
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        boxShadow: 'var(--shadow-card)',
      }}
    >
      {/* Header row */}
      <div className="flex items-start gap-3 mb-3">
        <Avatar name={name} email={row.email} size={40} />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[14.5px] font-semibold truncate" style={{ color: 'var(--ink)' }}>
                {name}
              </div>
              {row.full_name && (
                <div className="text-[12px] truncate" style={{ color: 'var(--muted)' }}>
                  {row.email}
                </div>
              )}
            </div>
            <span
              className="shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full"
              style={{ background: colors.bg, color: colors.text }}
            >
              {status.replace(/_/g, ' ')}
            </span>
          </div>
          <div
            className="flex items-center gap-2 mt-1 text-[12px]"
            style={{ color: 'var(--muted)' }}
          >
            <span className="font-medium" style={{ color: 'var(--ink-2)' }}>
              {roleLabel}
            </span>
            {row.group_id && <GroupBadge groupId={row.group_id} compact hideEmpty />}
            {changedAt && <span className="ml-auto">{changedAt}</span>}
          </div>
        </div>
      </div>

      {/* Status reason */}
      {row.status_reason && (
        <div
          className="text-[12px] mb-3 px-3 py-2 rounded-lg"
          style={{ background: 'var(--surface-2)', color: 'var(--muted)' }}
        >
          {row.status_reason}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        <Button size="sm" variant="ghost" onClick={() => onOpenProfile(row.id)} className="flex-1">
          Open profile
        </Button>
        <Button
          size="sm"
          variant="outline"
          loading={busy}
          onClick={() => onReactivate(row)}
          className="flex-1"
        >
          Reactivate
        </Button>
      </div>
    </div>
  );
}
