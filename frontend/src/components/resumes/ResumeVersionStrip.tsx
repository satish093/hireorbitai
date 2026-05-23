import { Fragment } from 'react';
import clsx from 'clsx';
import { Pill } from '../Pill';
import { AtsBar, fmtShortDate } from './AtsBits';
import type { ResumeVersion } from './types';

interface Props {
  versions: ResumeVersion[];
  activeId: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete?: (id: string) => void;
}

// solid success bg + white text → 4.5:1+ contrast at 11px (was 3:1 with soft bg)
const CURRENT_TONE = { bg: 'bg-success-soft', text: 'text-[#166534] dark:text-white' };

/**
 * Horizontal scrollable row of fat version cards. Arrows separate cards, the
 * active card gets an ink border + shadow, and a dashed "+ New" card at the end
 * opens a new tailor session. Scrolls horizontally once there are many versions.
 */
export function ResumeVersionStrip({ versions, activeId, onSelect, onNew, onDelete }: Props) {
  return (
    <div className="flex items-stretch gap-0 overflow-x-auto pb-2 -mx-1 px-1">
      {versions.map((v, i) => (
        <Fragment key={v.id}>
          {i > 0 && (
            <div className="self-center px-1 text-muted shrink-0 select-none" aria-hidden>
              ←
            </div>
          )}
          {/* Wrapper div so the delete button is a sibling of the card button,
              not nested inside it (nested-interactive a11y violation). */}
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => onSelect(v.id)}
              aria-pressed={v.id === activeId}
              className={clsx(
                'w-56 text-left rounded-xl border bg-surface p-3 transition hover-lift',
                v.id === activeId
                  ? 'border-ink shadow-md'
                  : 'border-border hover:border-border-strong',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-mono font-medium text-ink">v{v.version}</span>
                {v.is_current && (
                  <Pill tone={CURRENT_TONE} size="xs">
                    CURRENT
                  </Pill>
                )}
              </div>
              <div className="mt-1 text-[10px] font-mono text-muted">
                {fmtShortDate(v.created_at)}
              </div>
              <div className="mt-1.5 text-xs text-ink-2 line-clamp-2 min-h-[2rem] break-words">
                {v.file_name}
              </div>
              <AtsBar score={v.ai_score != null ? Math.round(v.ai_score) : null} className="mt-2" />
              {(v.tailored_job || v.tailored_for_job_id) && (
                <div className="mt-2 text-[10px] text-muted truncate">
                  Tailored for {v.tailored_job?.company_name ?? v.tailored_job?.title ?? 'a job'}
                </div>
              )}
            </button>
            {onDelete && (
              <button
                type="button"
                aria-label="Delete version"
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`Delete v${v.version} (${v.file_name})?`)) onDelete(v.id);
                }}
                className="absolute top-1.5 right-1.5 w-5 h-5 inline-flex items-center justify-center rounded-full text-muted hover:text-danger hover:bg-danger-soft text-xs transition"
              >
                ✕
              </button>
            )}
          </div>
        </Fragment>
      ))}
      {versions.length > 0 && (
        <div className="self-center px-1 text-muted shrink-0 select-none" aria-hidden>
          ←
        </div>
      )}
      <button
        type="button"
        onClick={onNew}
        className="shrink-0 w-40 rounded-xl border border-dashed border-border-strong p-3 grid place-items-center text-muted hover:text-ink hover:border-ink transition press"
      >
        <span className="text-sm font-medium">+ New tailor</span>
      </button>
    </div>
  );
}
