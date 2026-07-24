import clsx from 'clsx';
import { scoreTone } from './types';

const BAR: Record<'success' | 'warn' | 'danger', string> = {
  success: 'bg-success',
  warn: 'bg-warn',
  danger: 'bg-danger',
};
const TEXT: Record<'success' | 'warn' | 'danger', string> = {
  success: 'text-success',
  warn: 'text-warn',
  danger: 'text-danger',
};

/** Thin horizontal ATS score bar + numeric readout. */
export function AtsBar({
  score,
  className,
  showValue = true,
}: {
  score: number | null;
  className?: string;
  showValue?: boolean;
}) {
  const tone = scoreTone(score);
  const pct = Math.max(0, Math.min(100, score ?? 0));
  return (
    <div className={clsx('flex items-center gap-2', className)}>
      <div className="flex-1 h-1.5 rounded-full bg-bg-sunken overflow-hidden">
        <div
          className={clsx('h-full rounded-full transition-all', BAR[tone])}
          style={{ width: `${pct}%` }}
        />
      </div>
      {showValue && (
        <span className="text-[11px] font-mono tabular-nums text-ink shrink-0 w-7 text-right">
          {score ?? '—'}
        </span>
      )}
    </div>
  );
}

/** +N / -N delta chip. Renders nothing when delta is zero/undefined. */
export function DeltaPill({ delta, className }: { delta?: number | null; className?: string }) {
  if (delta == null || delta === 0) return null;
  const up = delta > 0;
  return (
    <span
      className={clsx(
        'text-[10px] font-mono font-medium px-1.5 py-0.5 rounded-full whitespace-nowrap',
        up ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger',
        className,
      )}
    >
      {up ? '+' : ''}
      {delta}
    </span>
  );
}

/** Circular ATS donut with the score in the middle. Size in px. */
export function AtsDonut({ score, size = 96 }: { score: number | null; size?: number }) {
  const tone = scoreTone(score);
  const pct = Math.max(0, Math.min(100, score ?? 0));
  const stroke = Math.round(size * 0.1);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const ringColor =
    tone === 'success' ? 'stroke-success' : tone === 'warn' ? 'stroke-warn' : 'stroke-danger';
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          className="stroke-bg-sunken"
          fill="none"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          className={clsx(ringColor, 'transition-all')}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c - (pct / 100) * c}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <span className={clsx('text-2xl font-semibold tabular-nums', TEXT[tone])}>
          {score ?? '—'}
        </span>
      </div>
    </div>
  );
}

export function fmtShortDate(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' });
}
