import { useEffect, useState } from 'react';

type Accent = 'brand' | 'blue' | 'green' | 'amber' | 'red' | 'slate';

interface Props {
  label: string;
  value: number | string;
  /** Trend text shown below the value, e.g. "+3 this week" or "6 on bench". */
  delta?: string;
  /** Set true when the trend is positive (renders ▲ in success color). */
  up?: boolean;
  accent?: Accent;
  onClick?: () => void;
  selected?: boolean;
}

const ACCENT_BAR: Record<Accent, string> = {
  brand: 'var(--accent)',
  blue: 'var(--blue)',
  green: 'var(--emerald)',
  amber: 'var(--amber)',
  red: 'var(--red)',
  slate: 'var(--faint)',
};

/**
 * KPI card — accent left-edge bar, large count-up value, optional trend delta.
 * Matches the Phase 2 design: 3px left bar, 800-weight value, 10.5px uppercase label.
 * Supersedes DashboardCard for the 4-up metric rows; DashboardCard stays for
 * the tasks-by-status breakdown cards.
 */
export function KpiCard({ label, value, delta, up, accent = 'slate', onClick, selected }: Props) {
  const animated = typeof value === 'number';
  const accentColor = ACCENT_BAR[accent];

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
      className="relative overflow-hidden rounded-[14px] p-[18px] transition-colors"
      style={{
        background: 'var(--surface)',
        border: `1px solid ${selected ? 'var(--ink)' : 'var(--border)'}`,
        boxShadow: 'var(--shadow-card)',
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      {/* Left accent bar */}
      <span
        aria-hidden="true"
        className="absolute left-0 top-0 bottom-0 w-[3px]"
        style={{ background: accentColor }}
      />

      <div
        className="text-[10.5px] font-bold uppercase tracking-[0.09em]"
        style={{ color: 'var(--ink-2)' }}
      >
        {label}
      </div>

      <div
        className="mt-1.5 text-[30px] font-extrabold leading-none tracking-tight tabular-nums"
        style={{ color: 'var(--ink)', letterSpacing: '-0.025em' }}
      >
        {animated ? <CountUp value={value as number} /> : value}
      </div>

      {delta && (
        <div className="mt-2 flex items-center gap-1 text-[12px]" style={{ color: 'var(--muted)' }}>
          {up && (
            <span className="font-bold" style={{ color: 'var(--success)' }}>
              ▲
            </span>
          )}
          {delta}
        </div>
      )}
    </div>
  );
}

function CountUp({ value }: { value: number }) {
  const [display, setDisplay] = useState(value);

  useEffect(() => {
    if (value === display) return;
    if (
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      setDisplay(value);
      return;
    }
    const start = display;
    const delta = value - start;
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / 600);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(Math.round(start + delta * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return <>{display}</>;
}
