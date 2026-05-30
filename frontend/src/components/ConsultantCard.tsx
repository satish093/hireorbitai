import { ReactNode } from 'react';
import { StatusBadge } from './StatusBadge';
import { Avatar } from './TaskBits';
import { GroupBadge } from './GroupBadge';

interface Recruiter {
  id: string;
  team?: string | null;
  user?: { full_name?: string | null; email?: string | null } | null;
}

export interface ConsultantRow {
  id: string;
  primary_skill?: string | null;
  visa_status?: string | null;
  total_experience_years?: number | null;
  marketing_status: 'ACTIVE' | 'PAUSED' | 'PLACED';
  current_location?: string | null;
  recruiter_id?: string | null;
  user?: {
    id?: string;
    full_name?: string | null;
    email?: string | null;
    group_id?: string | null;
  } | null;
  recruiter?: Recruiter | null;
}

interface Props {
  consultant: ConsultantRow;
  onClick: () => void;
  action?: ReactNode;
}

/**
 * Mobile entity card for a consultant row (< 768px).
 * Pairs with the desktop DataTable row — same data contract, different skin.
 */
export function ConsultantCard({ consultant: c, onClick, action }: Props) {
  const name = c.user?.full_name ?? c.user?.email ?? 'Unknown';
  const recruiterName = c.recruiter?.user?.full_name ?? c.recruiter?.user?.email ?? null;

  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onClick();
      }}
      className="flex items-start gap-3 p-4 rounded-xl cursor-pointer transition-colors hover:bg-hover active:bg-hover"
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        boxShadow: 'var(--shadow-card)',
      }}
    >
      {/* Avatar */}
      <Avatar name={name} email={c.user?.email} size={44} />

      {/* Main content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2 mb-0.5">
          <span className="text-[15px] font-semibold truncate" style={{ color: 'var(--ink)' }}>
            {name}
          </span>
          <StatusBadge status={c.marketing_status} />
        </div>

        {c.primary_skill && (
          <div className="text-[13px] mb-1.5" style={{ color: 'var(--muted)' }}>
            {c.primary_skill}
          </div>
        )}

        <div
          className="flex items-center flex-wrap gap-x-3 gap-y-1 text-[12px]"
          style={{ color: 'var(--muted)' }}
        >
          {c.visa_status && <Tag>{c.visa_status}</Tag>}
          {c.total_experience_years != null && <span>{c.total_experience_years}y exp</span>}
          {c.current_location && <span>{c.current_location}</span>}
        </div>

        {(recruiterName || c.user?.group_id) && (
          <div className="flex items-center gap-2 mt-1.5">
            {c.user?.group_id && <GroupBadge groupId={c.user.group_id} compact hideEmpty />}
            {recruiterName && (
              <span className="text-[11.5px]" style={{ color: 'var(--muted)' }}>
                {recruiterName}
              </span>
            )}
          </div>
        )}
      </div>

      {action && <div className="shrink-0 ml-1">{action}</div>}
    </div>
  );
}

function Tag({ children }: { children: ReactNode }) {
  return (
    <span
      className="inline-flex items-center px-1.5 py-px rounded-md text-[11px] font-semibold"
      style={{
        background: 'var(--surface-2)',
        color: 'var(--ink-2)',
        border: '1px solid var(--border)',
      }}
    >
      {children}
    </span>
  );
}

/** Client-side filter helper — reused by both desktop toolbar and mobile BottomSheet. */
export function filterConsultants(
  rows: ConsultantRow[],
  query: string,
  status: string,
): ConsultantRow[] {
  return rows.filter((c) => {
    if (status && status !== 'ALL' && c.marketing_status !== status) return false;
    if (query) {
      const q = query.toLowerCase();
      const name = (c.user?.full_name ?? c.user?.email ?? '').toLowerCase();
      const skill = (c.primary_skill ?? '').toLowerCase();
      const recruiter = (
        c.recruiter?.user?.full_name ??
        c.recruiter?.user?.email ??
        ''
      ).toLowerCase();
      if (!name.includes(q) && !skill.includes(q) && !recruiter.includes(q)) return false;
    }
    return true;
  });
}
