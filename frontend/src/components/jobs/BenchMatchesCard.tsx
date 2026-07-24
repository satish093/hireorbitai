import { Button } from '../Button';
import type { BenchMatch } from './jobsApi';

// Derive up-to-two uppercase initials from any display name.
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

// Score tone using only project design tokens.
function scoreTone(score: number): string {
  if (score >= 85) return 'text-success';
  if (score >= 75) return 'text-accent';
  return 'text-muted';
}

export function BenchMatchesCard({
  matches,
  selectedConsultantId,
  onSeeAll,
  loading,
}: {
  matches: BenchMatch[];
  selectedConsultantId?: string | null;
  onSeeAll?: () => void;
  loading?: boolean;
}): JSX.Element {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      {/* Eyebrow */}
      <div className="text-[11px] font-mono uppercase tracking-wider text-muted mb-3">
        Bench matches
      </div>

      {/* Body */}
      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-10 rounded-lg bg-bg-sunken animate-pulse" />
          ))}
        </div>
      ) : matches.length === 0 ? (
        <p className="text-[13px] text-muted py-2">No bench matches above 65%.</p>
      ) : (
        <ul className="space-y-1">
          {matches.map((match) => {
            const isSelected = match.id === selectedConsultantId;
            return (
              <li
                key={match.id}
                className={
                  'flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 ' +
                  (isSelected ? 'bg-accent-soft' : '')
                }
              >
                {/* Left: avatar + name/title */}
                <div className="flex items-center gap-2 min-w-0">
                  {/* 28px initials avatar */}
                  <span
                    aria-hidden="true"
                    className="w-7 h-7 shrink-0 rounded-md bg-accent-soft text-accent text-[11px] font-semibold grid place-items-center select-none"
                  >
                    {initials(match.name)}
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[13px] text-ink font-medium truncate">
                        {match.name}
                      </span>
                      {isSelected && (
                        <span className="text-[9px] font-semibold tracking-wide text-accent bg-surface border border-accent rounded px-1 shrink-0">
                          SELECTED
                        </span>
                      )}
                    </div>
                    {match.title && (
                      <div className="text-[11px] text-muted truncate">{match.title}</div>
                    )}
                  </div>
                </div>

                {/* Right: match score */}
                <span
                  className={
                    'text-[12px] font-mono tabular-nums shrink-0 ' + scoreTone(match.matchScore)
                  }
                >
                  {match.matchScore}%
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {/* Footer */}
      {onSeeAll && (
        <div className="mt-3 flex justify-end">
          <Button variant="ghost" size="sm" onClick={onSeeAll}>
            See all
          </Button>
        </div>
      )}
    </div>
  );
}
