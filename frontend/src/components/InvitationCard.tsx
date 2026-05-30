import { StatusBadge } from './StatusBadge';
import { ROLE_LABEL } from '../types';

export interface InvitationRow {
  id: string;
  email: string;
  role: string;
  status: string;
  created_at?: string | null;
  invitee_name?: string | null;
  group?: { name?: string | null } | null;
}

interface Props {
  invitation: InvitationRow;
}

/**
 * Mobile entity card for an Invitation (< 768px).
 * Pairs with the desktop DataTable row.
 */
export function InvitationCard({ invitation: inv }: Props) {
  const roleLabel = ROLE_LABEL[inv.role as keyof typeof ROLE_LABEL] ?? inv.role;
  const date = inv.created_at ? new Date(inv.created_at).toLocaleDateString() : null;
  const name = inv.invitee_name;

  return (
    <div
      className="p-4 rounded-xl"
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        boxShadow: 'var(--shadow-card)',
      }}
    >
      <div className="flex items-start justify-between gap-3 mb-1.5">
        <div className="min-w-0">
          {name && (
            <div className="text-[14.5px] font-semibold truncate" style={{ color: 'var(--ink)' }}>
              {name}
            </div>
          )}
          <div
            className="text-[13px] truncate"
            style={{ color: name ? 'var(--muted)' : 'var(--ink)', fontWeight: name ? 400 : 600 }}
          >
            {inv.email}
          </div>
        </div>
        <StatusBadge status={inv.status} />
      </div>

      <div className="flex items-center gap-3 text-[12px]" style={{ color: 'var(--muted)' }}>
        <span
          className="px-1.5 py-px rounded-md font-semibold text-[11px]"
          style={{
            background: 'var(--surface-2)',
            color: 'var(--ink-2)',
            border: '1px solid var(--border)',
          }}
        >
          {roleLabel}
        </span>
        {inv.group?.name && <span>{inv.group.name}</span>}
        {date && <span className="ml-auto">{date}</span>}
      </div>
    </div>
  );
}
