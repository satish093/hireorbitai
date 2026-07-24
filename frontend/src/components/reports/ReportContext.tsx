import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { CustomRange, RangeKey, ResolvedRange } from './types';

interface ReportContextValue {
  range: RangeKey;
  customRange: CustomRange | null;
  compareToPrior: boolean;
  setRange: (r: RangeKey) => void;
  setCustomRange: (c: CustomRange | null) => void;
  setCompare: (v: boolean) => void;
  resolved: ResolvedRange;
}

const Ctx = createContext<ReportContextValue | null>(null);

const DAY = 86_400_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmt = (d: Date) => `${MONTHS[d.getMonth()]} ${d.getDate()}`;

function resolve(range: RangeKey, custom: CustomRange | null): ResolvedRange {
  const to = new Date();
  let from = new Date();
  if (range === '7d') from = new Date(to.getTime() - 6 * DAY);
  else if (range === '30d') from = new Date(to.getTime() - 29 * DAY);
  else if (range === '90d') from = new Date(to.getTime() - 89 * DAY);
  else if (range === 'qtd') from = new Date(to.getFullYear(), Math.floor(to.getMonth() / 3) * 3, 1);
  else if (range === 'ytd') from = new Date(to.getFullYear(), 0, 1);
  else if (range === 'custom' && custom) {
    from = new Date(custom.from);
    return finalize(from, new Date(custom.to), 'custom');
  }
  return finalize(from, to, range);
}

function finalize(from: Date, to: Date, param: string): ResolvedRange {
  const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / DAY) + 1);
  return { from, to, days, label: `${fmt(from)} — ${fmt(to)} · ${days} days`, param };
}

export function ReportProvider({ children }: { children: ReactNode }) {
  const [range, setRange] = useState<RangeKey>('90d');
  const [customRange, setCustomRange] = useState<CustomRange | null>(null);
  const [compareToPrior, setCompare] = useState(false);

  const resolved = useMemo(() => resolve(range, customRange), [range, customRange]);

  const value = useMemo<ReportContextValue>(
    () => ({ range, customRange, compareToPrior, setRange, setCustomRange, setCompare, resolved }),
    [range, customRange, compareToPrior, resolved],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useReportContext(): ReportContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useReportContext must be used within <ReportProvider>');
  return v;
}
