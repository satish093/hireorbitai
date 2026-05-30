import { Link } from 'react-router-dom';
import { Avatar } from './TaskBits';
import { GroupBadge } from './GroupBadge';
import { Button } from './Button';

export interface RecruiterCardRow {
  id: string;
  team?: string | null;
  consultant_count?: number;
  user?: {
    id: string;
    full_name?: string | null;
    email?: string | null;
    group_id?: string | null;
  } | null;
  /** Primary manager name for the summary line. */
  primaryManager?: string | null;
}

interface Props {
  recruiter: RecruiterCardRow;
  onClick?: () => void;
  /** Mobile parity with the desktop "Supervisors" row action. */
  onSupervisors?: () => void;
  /** Mobile parity with the desktop "Group" row action. */
  onGroup?: () => void;
}

/**
 * Mobile entity card for a Recruiter (< 768px).
 * Pairs with the desktop DataTable row — same data contract, different skin.
 */
export function RecruiterCard({ recruiter: r, onClick, onSupervisors, onGroup }: Props) {
  const name = r.user?.full_name ?? r.user?.email ?? '—';
  const consultantCount = r.consultant_count ?? 0;
  const hasActions = !!(onSupervisors || onGroup);

  return (
    <div
      className="p-4 rounded-xl"
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        boxShadow: 'var(--shadow-card)',
      }}
    >
      <div
        onClick={onClick}
        role={onClick ? 'button' : undefined}
        tabIndex={onClick ? 0 : undefined}
        onKeyDown={
          onClick
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') onClick();
              }
            : undefined
        }
        className="flex items-start gap-3"
        style={{ cursor: onClick ? 'pointer' : 'default' }}
      >
        <Avatar name={name} email={r.user?.email} size={44} />

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-1">
            <span className="text-[15px] font-semibold" style={{ color: 'var(--ink)' }}>
              {name}
            </span>
            {consultantCount > 0 && (
              <Link
                to={`/consultants?recruiter=${r.id}`}
                onClick={(e) => e.stopPropagation()}
                className="shrink-0 text-[11px] font-bold px-2 py-0.5 rounded-full"
                style={{ background: 'var(--brand-soft)', color: 'var(--brand-on-soft)' }}
              >
                {consultantCount} consultant{consultantCount !== 1 ? 's' : ''}
              </Link>
            )}
          </div>

          <div
            className="flex items-center flex-wrap gap-x-3 gap-y-1 text-[12px]"
            style={{ color: 'var(--muted)' }}
          >
            {r.team && <span>{r.team}</span>}
            {r.user?.group_id && <GroupBadge groupId={r.user.group_id} compact hideEmpty />}
            {r.primaryManager && <span>Reports to {r.primaryManager}</span>}
          </div>
        </div>
      </div>

      {hasActions && (
        <div className="flex gap-2 mt-3 pt-3 border-t" style={{ borderColor: 'var(--border)' }}>
          {onSupervisors && (
            <Button size="sm" variant="ghost" className="flex-1" onClick={onSupervisors}>
              Supervisors
            </Button>
          )}
          {onGroup && (
            <Button size="sm" variant="outline" className="flex-1" onClick={onGroup}>
              Group
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/** Client-side filter for recruiters. */
export function filterRecruiters(rows: RecruiterCardRow[], query: string): RecruiterCardRow[] {
  if (!query) return rows;
  const q = query.toLowerCase();
  return rows.filter((r) => {
    const name = (r.user?.full_name ?? r.user?.email ?? '').toLowerCase();
    const team = (r.team ?? '').toLowerCase();
    return name.includes(q) || team.includes(q);
  });
}
