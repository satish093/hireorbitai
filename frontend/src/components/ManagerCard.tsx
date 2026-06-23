import { Link } from 'react-router-dom';
import { Avatar } from './TaskBits';
import { GroupBadge } from './GroupBadge';
import { StatusBadge } from './StatusBadge';
import { Button } from './Button';
import { ROLE_LABEL } from '../types';

export interface ManagerCardRow {
  id: string;
  email: string;
  full_name?: string | null;
  role: string;
  status?: string | null;
  group_id?: string | null;
  recruiter_count: number;
}

interface Props {
  manager: ManagerCardRow;
  /** Mobile parity with the desktop "Move group" row action (manager-tier only). */
  onMoveGroup?: () => void;
  /** Mobile parity with the desktop "Co-managed groups" action (admin-tier only). */
  onManageGrants?: () => void;
  /** Deactivate / reactivate the manager's account (admin-tier only). */
  onDeactivate?: () => void;
  onReactivate?: () => void;
}

/** A manager account counts as active unless it carries a non-active status. */
export function isManagerActive(status?: string | null): boolean {
  return (status ?? 'active') === 'active';
}

/**
 * Mobile entity card for a Manager (< 768px).
 * Pairs with the desktop DataTable row — same data contract, different skin.
 * Tapping the header opens the profile; the "Move group" footer mirrors the
 * desktop row action (rendered only when the caller has the permission).
 */
export function ManagerCard({
  manager: m,
  onMoveGroup,
  onManageGrants,
  onDeactivate,
  onReactivate,
}: Props) {
  const name = m.full_name ?? m.email;
  const roleLabel = ROLE_LABEL[m.role as keyof typeof ROLE_LABEL] ?? m.role;
  const active = isManagerActive(m.status);

  return (
    <div
      className="p-4 rounded-xl"
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        boxShadow: 'var(--shadow-card)',
      }}
    >
      <Link
        to={`/users/${m.id}`}
        className="flex items-start gap-3"
        style={{ textDecoration: 'none' }}
      >
        <Avatar name={name} email={m.email} size={44} />

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-1">
            <span className="text-[15px] font-semibold" style={{ color: 'var(--ink)' }}>
              {name}
            </span>
            {m.status && <StatusBadge status={m.status} />}
          </div>

          <div
            className="flex items-center flex-wrap gap-x-3 gap-y-1 text-[12px]"
            style={{ color: 'var(--muted)' }}
          >
            <span className="font-medium" style={{ color: 'var(--ink-2)' }}>
              {roleLabel}
            </span>
            {m.group_id && <GroupBadge groupId={m.group_id} compact hideEmpty />}
            {m.recruiter_count > 0 && (
              <span>
                {m.recruiter_count} recruiter{m.recruiter_count !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>
      </Link>

      {(onMoveGroup || onManageGrants || onDeactivate || onReactivate) && (
        <div
          className="flex flex-wrap gap-2 mt-3 pt-3 border-t"
          style={{ borderColor: 'var(--border)' }}
        >
          {onManageGrants && (
            <Button size="sm" variant="ghost" className="flex-1" onClick={onManageGrants}>
              Co-managed groups
            </Button>
          )}
          {onMoveGroup && (
            <Button size="sm" variant="outline" className="flex-1" onClick={onMoveGroup}>
              Move group
            </Button>
          )}
          {active && onDeactivate && (
            <Button size="sm" variant="danger-ghost" className="flex-1" onClick={onDeactivate}>
              Deactivate
            </Button>
          )}
          {!active && onReactivate && (
            <Button size="sm" variant="ghost" className="flex-1" onClick={onReactivate}>
              Reactivate
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/** Client-side filter for managers (search + optional account-status). */
export function filterManagers(
  rows: ManagerCardRow[],
  query: string,
  status: string = 'ALL',
): ManagerCardRow[] {
  const q = query.toLowerCase();
  return rows.filter((m) => {
    const active = isManagerActive(m.status);
    if (status === 'ACTIVE' && !active) return false;
    if (status === 'DEACTIVATED' && active) return false;
    if (q && !(m.full_name ?? m.email ?? '').toLowerCase().includes(q)) return false;
    return true;
  });
}
