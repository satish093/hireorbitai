import { ReactNode, useEffect, useState } from 'react';

interface Props {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  accent?: 'brand' | 'blue' | 'green' | 'amber' | 'red' | 'slate';
  selected?: boolean;
}

const accents: Record<NonNullable<Props['accent']>, string> = {
  brand: 'before:bg-brand-500',
  blue: 'before:bg-blue-500',
  green: 'before:bg-emerald-500',
  amber: 'before:bg-amber-500',
  red: 'before:bg-red-500',
  slate: 'before:bg-slate-400',
};

export function DashboardCard({ label, value, hint, accent = 'slate', selected }: Props) {
  return (
    <div
      className={`group relative bg-white rounded-xl border ${
        selected ? 'border-slate-900 shadow-sm' : 'border-slate-200'
      } p-5 overflow-hidden hover-lift before:absolute before:left-0 before:top-0 before:bottom-0 before:w-1 ${accents[accent]} before:scale-y-0 before:origin-top before:transition-transform before:duration-300 before:ease-out hover:before:scale-y-100`}
    >
      <div className="text-[10px] font-semibold tracking-widest text-slate-500 uppercase">{label}</div>
      <div className="text-3xl font-semibold mt-2 tabular-nums tracking-tight text-slate-900">
        {typeof value === 'number' ? <CountUp value={value} /> : value}
      </div>
      {hint && <div className="text-xs text-slate-500 mt-2">{hint}</div>}
    </div>
  );
}

/** Cheap requestAnimationFrame-based count-up. Kicks in when the displayed
 *  value changes, animating from the previous value to the next over ~600ms.
 *  Uses Math.round so the visible number is always an integer. */
function CountUp({ value }: { value: number }) {
  const [display, setDisplay] = useState(value);

  useEffect(() => {
    if (value === display) return;
    // Respect reduced-motion: skip the tween entirely.
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setDisplay(value);
      return;
    }
    const start = display;
    const delta = value - start;
    const duration = 600;
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / duration);
      // ease-out-cubic
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
