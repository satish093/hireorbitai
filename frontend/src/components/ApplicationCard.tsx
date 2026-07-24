import { StatusBadge } from './StatusBadge';
import { Avatar } from './TaskBits';

export interface ApplicationRow {
  id: string;
  status: string;
  submitted_at?: string | null;
  ats_score?: number | null;
  consultant?: {
    user?: { full_name?: string | null; email?: string | null } | null;
  } | null;
  job?: { title?: string | null } | null;
  vendor?: { company_name?: string | null } | null;
  recruiter?: {
    user?: { full_name?: string | null; email?: string | null } | null;
  } | null;
}

interface Props {
  application: ApplicationRow;
  onClick?: () => void;
}

/**
 * Mobile entity card for an application/submission row (< 768px).
 * Pairs with the desktop DataTable row — same data contract, different skin.
 */
export function ApplicationCard({ application: a, onClick }: Props) {
  const consultantName = a.consultant?.user?.full_name ?? a.consultant?.user?.email ?? '—';
  const jobTitle = a.job?.title ?? '—';
  const vendorName = a.vendor?.company_name ?? null;
  const date = a.submitted_at ? new Date(a.submitted_at).toLocaleDateString() : null;

  return (
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
      className="p-4 rounded-xl"
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        boxShadow: 'var(--shadow-card)',
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      {/* Top row: consultant + status */}
      <div className="flex items-center gap-2.5 mb-2">
        <Avatar name={consultantName} size={36} />
        <div className="flex-1 min-w-0">
          <span
            className="text-[14.5px] font-semibold block truncate"
            style={{ color: 'var(--ink)' }}
          >
            {consultantName}
          </span>
        </div>
        <StatusBadge status={a.status} />
      </div>

      {/* Job + vendor row */}
      <div className="ml-[44px] rounded-lg px-3 py-2" style={{ background: 'var(--surface-2)' }}>
        <div className="text-[13.5px] font-semibold truncate" style={{ color: 'var(--ink)' }}>
          {jobTitle}
        </div>
        <div className="flex items-center justify-between mt-0.5">
          {vendorName && (
            <span className="text-[12px] truncate" style={{ color: 'var(--muted)' }}>
              {vendorName}
            </span>
          )}
          {date && (
            <span className="text-[11.5px] ml-auto shrink-0" style={{ color: 'var(--faint)' }}>
              {date}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/** Client-side filter by stage. */
export function filterApplications(rows: ApplicationRow[], status: string): ApplicationRow[] {
  if (!status || status === 'ALL') return rows;
  return rows.filter((a) => a.status === status);
}
