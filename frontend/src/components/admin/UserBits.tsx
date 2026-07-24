import clsx from 'clsx';
import { Pill } from '../Pill';
import { Role, ROLE_LABEL } from '../../types';
import { STATUS_TONE, STATUS_LABEL, type GroupLite, type Status } from './types';

/** Status pill using the shared token tones. */
export function StatusPill({ status, reason }: { status: Status; reason?: string | null }) {
  return (
    <span title={reason ?? undefined}>
      <Pill tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Pill>
    </span>
  );
}

/** Compact role chip. */
export function RoleChip({ role }: { role: Role }) {
  return (
    <span className="inline-flex items-center text-[11px] font-medium bg-hover text-ink-2 px-1.5 py-0.5 rounded">
      {ROLE_LABEL[role] ?? role}
    </span>
  );
}

/** Colored group badge, or a muted "No group" when unassigned/unknown. */
export function GroupBadge({ group }: { group?: GroupLite | null }) {
  if (!group) return <span className="text-[11px] text-muted italic">No group</span>;
  const color = group.color ?? '#6366F1';
  return (
    <span
      className="inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded text-[11px] font-medium"
      style={{ background: `${color}1A`, color }}
      title={group.unique_group_id ?? undefined}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
      {group.name}
    </span>
  );
}

/** A bare checkbox styled to the accent token. */
export function Check({
  checked,
  onChange,
  label,
  indeterminate,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  indeterminate?: boolean;
}) {
  return (
    <input
      type="checkbox"
      aria-label={label}
      checked={checked}
      ref={(el) => {
        if (el) el.indeterminate = !!indeterminate && !checked;
      }}
      onChange={onChange}
      onClick={(e) => e.stopPropagation()}
      className={clsx('w-4 h-4 rounded accent-[color:var(--accent)] cursor-pointer')}
    />
  );
}
