import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { Button } from '../Button';
import { EmptyState } from '../EmptyState';
import { Skeleton } from '../Skeleton';
import { api } from '../../services/api';
import { DeltaPill, fmtShortDate } from './AtsBits';
import type { TailorSession } from './types';

interface Props {
  resumeId: string;
  refreshKey: number;
  activeSessionId: string | null;
  onOpenSession: (sessionId: string) => void;
  onNewSession: () => void;
}

/**
 * Left rail timeline of tailor sessions for the currently active version. The
 * most recent node has a filled dot; older nodes are outlined. Each node shows
 * the target company, score delta, mono meta, and a plain-English summary.
 */
export function TailorHistory({
  resumeId,
  refreshKey,
  activeSessionId,
  onOpenSession,
  onNewSession,
}: Props) {
  const [sessions, setSessions] = useState<TailorSession[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!resumeId) {
      setSessions([]);
      return;
    }
    let cancelled = false;
    setSessions(null);
    setError(false);
    api
      .get(`/resumes/${resumeId}/tailor-sessions`, { params: { versionId: resumeId } })
      .then((r) => !cancelled && setSessions(r.data ?? []))
      .catch(() => !cancelled && setError(true))
      .finally(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [resumeId, refreshKey]);

  return (
    <aside className="flex flex-col bg-surface border border-border rounded-xl p-3 lg:max-h-[78vh]">
      <div className="text-[10px] font-semibold tracking-widest text-muted uppercase px-1 mb-2">
        Tailor history
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto -mr-1 pr-1">
        {sessions === null && !error && (
          <div className="space-y-3 pt-1">
            {[0, 1].map((i) => (
              <div key={i} className="pl-5 space-y-2">
                <Skeleton className="h-3 w-2/3" />
                <Skeleton className="h-2.5 w-1/2" />
                <Skeleton className="h-2.5 w-5/6" />
              </div>
            ))}
          </div>
        )}

        {error && (
          <EmptyState
            compact
            title="Couldn't load history"
            description="Try selecting the version again."
          />
        )}

        {sessions && sessions.length === 0 && !error && (
          <EmptyState
            compact
            icon="✦"
            title="No tailor sessions"
            description="Tailor this version for a job to start the timeline."
          />
        )}

        {sessions && sessions.length > 0 && (
          <ol className="relative pl-5">
            <span className="absolute left-[6px] top-1 bottom-1 w-px bg-border" aria-hidden />
            {sessions.map((s, i) => {
              const delta = s.score_after != null ? s.score_after - s.score_before : null;
              const isActive = s.id === activeSessionId;
              return (
                <li key={s.id} className="relative pb-4 last:pb-0">
                  <span
                    className={clsx(
                      'absolute -left-[15px] top-1 w-2.5 h-2.5 rounded-full border-2',
                      i === 0 ? 'bg-accent border-accent' : 'bg-surface border-border-strong',
                    )}
                    aria-hidden
                  />
                  <button
                    type="button"
                    onClick={() => onOpenSession(s.id)}
                    aria-pressed={isActive}
                    className={clsx(
                      'w-full text-left rounded-lg border p-2.5 transition press',
                      isActive
                        ? 'border-ink bg-bg-sunken'
                        : 'border-transparent hover:border-border hover:bg-hover',
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-ink truncate">
                        {s.job?.company_name ?? s.job?.title ?? 'Untitled session'}
                      </span>
                      <DeltaPill delta={delta} />
                    </div>
                    <div className="mt-0.5 text-[10px] font-mono text-muted truncate">
                      {fmtShortDate(s.created_at)}
                      {s.job?.title ? ` · ${s.job.title}` : ''} · {s.edit_count} edit
                      {s.edit_count === 1 ? '' : 's'}
                    </div>
                    {s.ai_summary && (
                      <p className="mt-1 text-xs text-ink-2 line-clamp-2">{s.ai_summary}</p>
                    )}
                    <div className="mt-1.5 text-[10px] font-mono text-muted">
                      {s.score_before}
                      <span className="px-1">→</span>
                      <span className="text-success">{s.score_after ?? '—'}</span>
                      {s.applied && <span className="ml-1.5 text-muted">· applied</span>}
                    </div>
                  </button>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      <Button variant="accent" block size="sm" className="mt-3" onClick={onNewSession}>
        ✦ New tailor session
      </Button>
    </aside>
  );
}
