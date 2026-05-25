import { Fragment } from 'react';
import clsx from 'clsx';
import { Pill } from '../Pill';
import { fmtShortDate } from './AtsBits';
import type { ResumeVersion } from './types';

interface Props {
  versions: ResumeVersion[];
  activeId: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete?: (id: string) => void;
}

const CURRENT_TONE = { bg: 'bg-success-soft', text: 'text-[#166534] dark:text-white' };

function AtsChip({ score }: { score: number | null }) {
  if (score == null) return null;
  const s = Math.round(score);
  const cls =
    s >= 80
      ? 'text-emerald-700 dark:text-emerald-400'
      : s >= 60
        ? 'text-amber-700 dark:text-amber-400'
        : 'text-red-700 dark:text-red-400';
  return <span className={`text-[11px] font-bold tabular-nums ${cls}`}>ATS {s}</span>;
}

export function ResumeVersionStrip({ versions, activeId, onSelect, onNew, onDelete }: Props) {
  return (
    <div className="flex items-stretch gap-2 overflow-x-auto pb-1 -mx-1 px-1">
      {versions.map((v) => (
        <div key={v.id} className="relative shrink-0 group">
          <button
            type="button"
            onClick={() => onSelect(v.id)}
            aria-pressed={v.id === activeId}
            className={clsx(
              'w-48 text-left rounded-xl border p-3 transition-all duration-150',
              v.id === activeId
                ? 'border-accent bg-accent/5 shadow-sm'
                : 'border-border bg-surface hover:border-accent/40 hover:bg-hover',
            )}
          >
            {/* Top row: version badge + current pill */}
            <div className="flex items-center justify-between gap-1 mb-2">
              <span
                className={clsx(
                  'text-[11px] font-mono font-bold px-1.5 py-0.5 rounded',
                  v.id === activeId ? 'bg-accent text-white' : 'bg-hover text-muted',
                )}
              >
                v{v.version}
              </span>
              {v.is_current && (
                <Pill tone={CURRENT_TONE} size="xs">
                  CURRENT
                </Pill>
              )}
            </div>

            {/* Date */}
            <div className="text-[10px] text-muted font-mono mb-1">
              {fmtShortDate(v.created_at)}
            </div>

            {/* Filename */}
            <div className="text-[11px] text-ink-2 truncate leading-snug">{v.file_name}</div>

            {/* ATS score */}
            <div className="mt-2">
              <AtsChip score={v.ai_score ?? null} />
            </div>

            {/* Tailored-for label */}
            {(v.tailored_job || v.tailored_for_job_id) && (
              <div className="mt-1 text-[10px] text-muted truncate">
                ✦ {v.tailored_job?.company_name ?? v.tailored_job?.title ?? 'tailored'}
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
              className="absolute top-2 right-2 w-5 h-5 inline-flex items-center justify-center rounded-full text-muted opacity-0 group-hover:opacity-100 hover:text-danger hover:bg-danger-soft text-xs transition-all"
            >
              ✕
            </button>
          )}
        </div>
      ))}

      {/* New tailor card */}
      <button
        type="button"
        onClick={onNew}
        className="shrink-0 w-36 rounded-xl border border-dashed border-border p-3 flex flex-col items-center justify-center gap-1 text-muted hover:text-accent hover:border-accent/50 hover:bg-accent/5 transition-all duration-150"
      >
        <span className="text-xl leading-none">+</span>
        <span className="text-xs font-medium">New tailor</span>
      </button>
    </div>
  );
}
