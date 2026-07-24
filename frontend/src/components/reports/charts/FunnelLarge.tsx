import { useNavigate } from 'react-router-dom';
import { EmptyChart } from '../EmptyChart';
import type { FunnelStage } from '../types';

export function FunnelLarge({ stages }: { stages: FunnelStage[] }): JSX.Element {
  const navigate = useNavigate();

  if (!stages?.length) {
    return <EmptyChart />;
  }

  function handleNav(stage: string) {
    if (stage.toLowerCase() === 'sourced') {
      navigate('/applications');
    } else {
      navigate(`/applications?status=${stage.toUpperCase()}`);
    }
  }

  return (
    <div className="space-y-3">
      {stages.map((s, index) => {
        const opacity = Math.max(0.3, 1 - index * 0.13);
        return (
          <div
            key={s.stage}
            role="button"
            tabIndex={0}
            className="cursor-pointer rounded-md px-1 -mx-1 hover:bg-hover"
            onClick={() => handleNav(s.stage)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleNav(s.stage);
              }
            }}
          >
            {/* Top label row */}
            <div className="flex items-center justify-between mb-1">
              <span className="text-[13px] text-ink">{s.stage}</span>
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-mono text-ink-2">{s.pct}%</span>
                <span className="text-[13px] font-mono font-semibold text-ink">
                  {s.count.toLocaleString()}
                </span>
              </div>
            </div>

            {/* Bar track */}
            <div className="h-6 rounded-md bg-bg-sunken overflow-hidden">
              <div
                className="h-full rounded-md bg-brand-grad"
                style={{ width: `${s.pct}%`, opacity }}
              />
            </div>

            {/* Drop-off annotation */}
            {s.dropPct != null && (
              <div className="text-[11px] font-mono text-danger mt-0.5">drop -{s.dropPct}%</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
