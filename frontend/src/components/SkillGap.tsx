import { useEffect, useState } from 'react';
import { api } from '../services/api';

/**
 * Skill-gap card rendered inside the expanded job detail.
 *
 * Hits GET /jobs/:id/skill-gap (deterministic, no AI call) on mount. Shows:
 *   - Coverage percent (X of Y required skills)
 *   - Pills for matched skills (emerald)
 *   - Pills for missing skills (rose)
 *
 * Falls back to a "complete your profile" hint when the calling user has no
 * consultant row, so this component is safe to drop in regardless of who's
 * viewing the job (recruiter, admin, etc.).
 */

interface SkillGapResponse {
  consultant_resolved: boolean;
  consultant_id?: string;
  have: string[];
  missing: string[];
  coverage: number;
  match_score: number | null;
}

export function SkillGap({ jobId, compact }: { jobId: string; compact?: boolean }) {
  const [data, setData] = useState<SkillGapResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .get<SkillGapResponse>(`/jobs/${jobId}/skill-gap`)
      .then((r) => {
        if (!cancelled) setData(r.data);
      })
      .catch((e) => {
        if (!cancelled) setError(e?.response?.data?.error ?? 'Failed to load skill gap');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  if (loading) {
    return (
      <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs text-slate-500">
        Analyzing skill match…
      </div>
    );
  }
  if (error) {
    return (
      <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs text-slate-500">
        Skill gap unavailable.
      </div>
    );
  }
  if (!data) return null;

  // Don't render at all when the job has no extracted required_skills — the
  // gap is meaningless and a "0 of 0 matched" pill is just visual noise.
  if (data.have.length === 0 && data.missing.length === 0) return null;

  if (!data.consultant_resolved) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
        Complete your consultant profile (skills) to see how this role matches you.
      </div>
    );
  }

  const total = data.have.length + data.missing.length;
  const pct = data.coverage;
  const tone = pct >= 80 ? 'emerald' : pct >= 60 ? 'sky' : pct >= 40 ? 'amber' : 'rose';
  const toneClasses: Record<string, { bar: string; text: string; ring: string }> = {
    emerald: { bar: 'bg-emerald-500', text: 'text-emerald-700', ring: 'ring-emerald-200' },
    sky: { bar: 'bg-sky-500', text: 'text-sky-700', ring: 'ring-sky-200' },
    amber: { bar: 'bg-amber-500', text: 'text-amber-700', ring: 'ring-amber-200' },
    rose: { bar: 'bg-rose-500', text: 'text-rose-700', ring: 'ring-rose-200' },
  };
  const t = toneClasses[tone];

  return (
    <div
      className={`bg-white border border-slate-200 rounded-lg p-4 ring-1 ${t.ring} ${
        compact ? 'space-y-2' : 'space-y-3'
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">
          Skill match
        </div>
        <div className={`text-sm font-semibold ${t.text}`}>
          {data.have.length} of {total} ({pct}%)
        </div>
      </div>

      {/* Coverage bar */}
      <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full ${t.bar} transition-all`} style={{ width: `${pct}%` }} />
      </div>

      {data.have.length > 0 && (
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700 mb-1.5">
            ✓ You have
          </div>
          <div className="flex flex-wrap gap-1">
            {data.have.map((s) => (
              <span
                key={s}
                className="inline-flex items-center text-[11px] font-medium bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full border border-emerald-100"
              >
                {s}
              </span>
            ))}
          </div>
        </div>
      )}

      {data.missing.length > 0 && (
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-rose-700 mb-1.5">
            ✗ Missing
          </div>
          <div className="flex flex-wrap gap-1">
            {data.missing.map((s) => (
              <span
                key={s}
                className="inline-flex items-center text-[11px] font-medium bg-rose-50 text-rose-700 px-2 py-0.5 rounded-full border border-rose-100"
              >
                {s}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
