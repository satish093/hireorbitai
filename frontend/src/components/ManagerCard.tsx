import { Link } from 'react-router-dom';
import { Avatar } from './TaskBits';
import { GroupBadge } from './GroupBadge';
import { StatusBadge } from './StatusBadge';
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
  onClick?: () => void;
}

/**
 * Mobile entity card for a Manager (< 768px).
 * Pairs with the desktop DataTable row — same data contract, different skin.
 */
export function ManagerCard({ manager: m, onClick }: Props) {
  const name = m.full_name ?? m.email;
  const roleLabel = ROLE_LABEL[m.role as keyof typeof ROLE_LABEL] ?? m.role;

  return (
    <Link
      to={`/users/${m.id}`}
      onClick={
        onClick
          ? (e) => {
              e.preventDefault();
              onClick();
            }
          : undefined
      }
      className="flex items-start gap-3 p-4 rounded-xl"
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        boxShadow: 'var(--shadow-card)',
        textDecoration: 'none',
        display: 'flex',
      }}
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
  );
}

/** Client-side filter for managers. */
export function filterManagers(rows: ManagerCardRow[], query: string): ManagerCardRow[] {
  if (!query) return rows;
  const q = query.toLowerCase();
  return rows.filter((m) => (m.full_name ?? m.email ?? '').toLowerCase().includes(q));
}
