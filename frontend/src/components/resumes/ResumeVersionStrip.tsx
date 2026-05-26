import clsx from 'clsx';
import { fmtShortDate } from './AtsBits';
import type { ResumeVersion } from './types';

interface Props {
  versions: ResumeVersion[];
  activeId: string;
  onSelect: (id: string) => void;
  onDelete?: (id: string) => void;
  onUpload?: (file: File) => void;
  uploading?: boolean;
}

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

export function ResumeVersionStrip({
  versions,
  activeId,
  onSelect,
  onDelete,
  onUpload,
  uploading,
}: Props) {
  return (
    <div className="flex items-stretch gap-2 overflow-x-auto pb-1 -mx-1 px-1">
      {versions.map((v) => (
        <div key={v.id} className="relative shrink-0">
          {/* Delete button — always visible, floats outside top-right corner */}
          {onDelete && (
            <button
              type="button"
              aria-label={`Delete v${v.version}`}
              onClick={(e) => {
                e.stopPropagation();
                if (confirm(`Delete v${v.version} — ${v.file_name}?`)) onDelete(v.id);
              }}
              className="absolute -top-2 -right-2 z-10 w-5 h-5 inline-flex items-center justify-center rounded-full bg-surface border border-border text-muted hover:text-danger hover:border-danger/60 hover:bg-danger-soft text-[10px] font-bold shadow-sm transition-all"
            >
              ✕
            </button>
          )}

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
            {/* Top row: version badge */}
            <div className="flex items-center gap-1 mb-2">
              <span
                className={clsx(
                  'text-[11px] font-mono font-bold px-1.5 py-0.5 rounded',
                  v.id === activeId ? 'bg-accent text-white dark:text-bg' : 'bg-hover text-muted',
                )}
              >
                v{v.version}
              </span>
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
        </div>
      ))}

      {/* Upload card */}
      {onUpload && (
        <label
          className={clsx(
            'shrink-0 w-36 rounded-xl border border-dashed p-3 flex flex-col items-center justify-center gap-1 transition-all duration-150',
            uploading
              ? 'border-border text-muted cursor-not-allowed opacity-60'
              : 'border-border text-muted hover:text-accent hover:border-accent/50 hover:bg-accent/5 cursor-pointer',
          )}
        >
          <span className="text-xl leading-none">{uploading ? '…' : '+'}</span>
          <span className="text-xs font-medium">{uploading ? 'Uploading…' : 'Upload'}</span>
          <input
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.webp"
            disabled={uploading}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) {
                onUpload(f);
                e.target.value = '';
              }
            }}
          />
        </label>
      )}
    </div>
  );
}
