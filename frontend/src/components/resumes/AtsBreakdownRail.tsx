import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { EmptyState } from '../EmptyState';
import { Skeleton } from '../Skeleton';
import { api } from '../../services/api';
import { AtsDonut, AtsBar, DeltaPill } from './AtsBits';
import { scoreTone } from './types';
import type { AtsFactorsResponse, ResumeVersion, SkillCoverage } from './types';

interface Props {
  resumeId: string;
  versions: ResumeVersion[];
  againstJobId?: string | null;
}

const BAR: Record<'success' | 'warn' | 'danger', string> = {
  success: 'bg-success',
  warn: 'bg-warn',
  danger: 'bg-danger',
};

const COVERAGE: Record<SkillCoverage['level'], { cls: string; prefix: string; label: string }> = {
  strong: { cls: 'bg-accent-soft text-accent', prefix: '', label: 'Strong' },
  gap: { cls: 'bg-warn-soft text-warn', prefix: '◐ ', label: 'Gap' },
  missing: { cls: 'bg-danger-soft text-danger', prefix: '✕ ', label: 'Missing' },
};

export function AtsBreakdownRail({ resumeId, versions, againstJobId }: Props) {
  const [data, setData] = useState<AtsFactorsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!resumeId) {
      setData(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(false);
    api
      .get(`/resumes/${resumeId}/ats-factors`, {
        params: againstJobId ? { against: againstJobId } : {},
      })
      .then((r) => !cancelled && setData(r.data))
      .catch(() => !cancelled && setError(true))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [resumeId, againstJobId]);

  const active = versions.find((v) => v.id === resumeId);
  const prev = active
    ? versions.filter((v) => v.version < active.version).sort((a, b) => b.version - a.version)[0]
    : undefined;
  const prevScore = prev?.ai_score != null ? Math.round(prev.ai_score) : null;
  const delta = data?.overall != null && prevScore != null ? data.overall - prevScore : null;

  if (loading) {
    return (
      <aside className="bg-surface border border-border rounded-xl p-4 space-y-4">
        <div className="flex justify-center">
          <Skeleton className="!rounded-full" width={96} height={96} />
        </div>
        <Skeleton className="h-3 w-2/3" />
        <Skeleton className="h-3 w-5/6" />
        <Skeleton className="h-3 w-1/2" />
      </aside>
    );
  }

  if (error || !data) {
    return (
      <aside className="bg-surface border border-border rounded-xl p-4">
        <EmptyState
          compact
          title="No ATS data"
          description="Select a version to see its score factors."
        />
      </aside>
    );
  }

  return (
    <aside className="bg-surface border border-border rounded-xl p-4 lg:max-h-[78vh] overflow-y-auto space-y-5">
      {/* 1 — donut */}
      <div className="flex flex-col items-center text-center">
        <AtsDonut score={data.overall} />
        <div className="mt-2 flex items-center gap-2">
          <DeltaPill delta={delta} />
          {prev && <span className="text-[11px] text-muted">vs v{prev.version}</span>}
        </div>
        {data.target && (
          <div className="mt-1 text-[11px] text-muted">
            against {data.target.company_name ?? data.target.title}
          </div>
        )}
      </div>

      {/* 2 — factor breakdown */}
      <div>
        <div className="text-[10px] font-semibold tracking-widest text-muted uppercase mb-2">
          Factors
        </div>
        <div className="space-y-2.5">
          {data.factors.map((f) => (
            <div key={f.key}>
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-xs text-ink">{f.label}</span>
                <span className="text-[11px] font-mono tabular-nums text-muted">{f.score}</span>
              </div>
              <div className="h-1.5 rounded-full bg-bg-sunken overflow-hidden">
                <div
                  className={clsx('h-full rounded-full', BAR[scoreTone(f.score)])}
                  style={{ width: `${Math.max(0, Math.min(100, f.score))}%` }}
                />
              </div>
              <div className="text-[10px] text-muted mt-0.5">{f.hint}</div>
            </div>
          ))}
        </div>
      </div>

      {/* 3 — skill coverage */}
      {data.coverage.length > 0 && (
        <div>
          <div className="text-[10px] font-semibold tracking-widest text-muted uppercase mb-2">
            Skills coverage
          </div>
          <div className="flex flex-wrap gap-1.5">
            {data.coverage.map((c) => (
              <span
                key={c.skill}
                className={clsx(
                  'text-[11px] font-medium px-2 py-0.5 rounded-full',
                  COVERAGE[c.level].cls,
                )}
              >
                {COVERAGE[c.level].prefix}
                {c.skill}
              </span>
            ))}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-[10px] text-muted">
            {(['strong', 'gap', 'missing'] as const).map((lvl) => (
              <span key={lvl} className="inline-flex items-center gap-1">
                <span className={clsx('w-2 h-2 rounded-full', BAR_DOT[lvl])} aria-hidden />
                {COVERAGE[lvl].label}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 4 — scored against */}
      {data.scored_against.length > 0 && (
        <div>
          <div className="text-[10px] font-semibold tracking-widest text-muted uppercase mb-2">
            Scored against
          </div>
          <ul className="space-y-2">
            {data.scored_against.map((j) => (
              <li key={j.job_id} className="text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-ink truncate">{j.company_name ?? j.title}</span>
                </div>
                <AtsBar score={j.ats_score ?? j.match_score} className="mt-1" />
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  );
}

const BAR_DOT: Record<SkillCoverage['level'], string> = {
  strong: 'bg-accent',
  gap: 'bg-warn',
  missing: 'bg-danger',
};
