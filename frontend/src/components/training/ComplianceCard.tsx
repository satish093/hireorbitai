import { Link } from 'react-router-dom';
import { DOT_TONE, type ComplianceItem } from './types';

/** Right-rail card: required compliance courses with dot-coded status. */
export function ComplianceCard({ items, dueSoon }: { items: ComplianceItem[]; dueSoon: number }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px] font-mono uppercase tracking-wider text-muted">
          Compliance
        </span>
        {dueSoon > 0 && (
          <span className="text-[10px] font-mono uppercase bg-warn-soft text-warn rounded px-1.5 py-0.5">
            {dueSoon} due
          </span>
        )}
      </div>
      {items.length === 0 ? (
        <p className="text-[12px] text-muted">No required courses right now.</p>
      ) : (
        <ul className="space-y-2.5">
          {items.map((it) => (
            <li key={it.assignment_id} className="flex items-start gap-2.5">
              <span
                className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${DOT_TONE[it.tone]}`}
                aria-hidden="true"
              />
              <Link
                to={`/training/assignments/${it.assignment_id}`}
                className="min-w-0 flex-1 group"
              >
                <div className="text-[13px] text-ink truncate group-hover:underline">
                  {it.title}
                </div>
                <div className="text-[11px] text-muted">
                  {it.status === 'COMPLETED'
                    ? 'Valid'
                    : it.due_date
                      ? `Due ${new Date(it.due_date).toLocaleDateString()}`
                      : 'No deadline'}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
