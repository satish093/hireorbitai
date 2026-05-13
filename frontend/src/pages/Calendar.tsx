import { useEffect, useMemo, useState } from 'react';
import { Layout } from '../components/Layout';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/Button';
import { api } from '../services/api';
import { StatusBadge } from '../components/StatusBadge';
import clsx from 'clsx';
import toast from 'react-hot-toast';

interface CalEvent { id: string; title: string; when: string; kind: 'interview' | 'reminder'; status: string; }

export function Calendar() {
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [month, setMonth] = useState(() => new Date());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const start = new Date(month.getFullYear(), month.getMonth(), 1, 0, 0, 0, 0);
    const end = new Date(month.getFullYear(), month.getMonth() + 1, 0, 23, 59, 59, 999);
    const from = start.toISOString();
    const to = end.toISOString();
    Promise.all([
      api.get(`/interviews?from=${from}&to=${to}`),
      api.get('/reminders'),
    ]).then(([iRes, rRes]) => {
      if (cancelled) return;
      const interviews: CalEvent[] = (iRes.data ?? []).map((i: any) => ({
        id: i.id,
        title: `${i.type ?? 'Interview'}${i.is_mock ? ' (mock)' : ''}${i.interviewer ? ` · ${i.interviewer}` : ''}`,
        when: i.scheduled_at,
        kind: 'interview',
        status: i.status,
      }));
      const reminders: CalEvent[] = (rRes.data ?? [])
        .filter((r: any) => {
          if (!r.due_at) return false;
          const d = new Date(r.due_at);
          return d >= start && d <= end;
        })
        .map((r: any) => ({ id: r.id, title: r.title, when: r.due_at, kind: 'reminder', status: r.status }));
      setEvents([...interviews, ...reminders].sort((a, b) => a.when.localeCompare(b.when)));
    }).catch((e) => {
      if (cancelled) return;
      toast.error(e?.response?.data?.error ?? 'Failed to load calendar');
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [month]);

  const byDay = useMemo(() => {
    const map: Record<string, CalEvent[]> = {};
    for (const e of events) {
      const k = new Date(e.when).toDateString();
      (map[k] ??= []).push(e);
    }
    return map;
  }, [events]);

  const start = new Date(month.getFullYear(), month.getMonth(), 1);
  const end = new Date(month.getFullYear(), month.getMonth() + 1, 0);
  const leading = start.getDay();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < leading; i++) cells.push(null);
  for (let d = 1; d <= end.getDate(); d++) cells.push(new Date(month.getFullYear(), month.getMonth(), d));
  // Pad to a multiple of 7 so the grid lines stay regular.
  while (cells.length % 7 !== 0) cells.push(null);

  const today = new Date();
  const isToday = (d: Date) =>
    d.getDate() === today.getDate() && d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear();

  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <Layout title="Calendar">
      <PageHeader
        title="Calendar"
        description="Interviews and reminders across the month. Click a date to filter."
        action={
          <div className="inline-flex items-center gap-1 bg-white border border-slate-200 rounded-lg p-1 shadow-sm">
            <button
              onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
              className="w-7 h-7 inline-flex items-center justify-center rounded-md text-slate-600 hover:bg-slate-100"
              aria-label="Previous month"
            >‹</button>
            <span className="text-sm font-medium text-slate-900 min-w-[120px] text-center">
              {month.toLocaleString(undefined, { month: 'long', year: 'numeric' })}
            </span>
            <button
              onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
              className="w-7 h-7 inline-flex items-center justify-center rounded-md text-slate-600 hover:bg-slate-100"
              aria-label="Next month"
            >›</button>
            <span className="w-px h-5 bg-slate-200 mx-1" />
            <Button size="sm" variant="ghost" onClick={() => setMonth(new Date())}>Today</Button>
          </div>
        }
      />

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
          {DOW.map((d) => (
            <div key={d} className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 px-3 py-2">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((d, idx) => (
            <div
              key={d ? d.toISOString() : `blank-${idx}`}
              className={clsx(
                'min-h-[110px] border-r border-b border-slate-100 p-2',
                (idx + 1) % 7 === 0 && 'border-r-0',
                idx >= cells.length - 7 && 'border-b-0',
                !d && 'bg-slate-50/40',
              )}
            >
              {d && (
                <>
                  <div className={clsx(
                    'text-xs font-semibold mb-1.5 inline-flex items-center justify-center w-6 h-6 rounded-full',
                    isToday(d) ? 'bg-slate-900 text-white' : 'text-slate-700',
                  )}>
                    {d.getDate()}
                  </div>
                  {!loading && (byDay[d.toDateString()] ?? []).slice(0, 3).map((e, ei) => (
                    <div
                      key={e.id}
                      style={{ animationDelay: `${ei * 30}ms` }}
                      className={clsx(
                        'mb-1 rounded-md px-1.5 py-0.5 border text-[11px] leading-tight cursor-pointer animate-fade-in-up transition hover:scale-[1.02] hover:shadow-sm',
                        e.kind === 'interview' ? 'bg-indigo-50 border-indigo-100 text-indigo-800 hover:bg-indigo-100' : 'bg-amber-50 border-amber-100 text-amber-800 hover:bg-amber-100',
                      )}
                      title={`${new Date(e.when).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} — ${e.title}`}
                    >
                      <span className="font-medium">{new Date(e.when).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>{' '}
                      <span className="truncate">{e.title}</span>
                    </div>
                  ))}
                  {(byDay[d.toDateString()]?.length ?? 0) > 3 && (
                    <div className="text-[10px] text-slate-500 mt-0.5">
                      +{(byDay[d.toDateString()] ?? []).length - 3} more
                    </div>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Today list */}
      <div className="mt-5">
        <h2 className="text-sm font-semibold text-slate-900 mb-2">Today</h2>
        <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
          {(byDay[today.toDateString()] ?? []).length === 0 ? (
            <div className="px-4 py-6 text-sm text-slate-400 italic text-center">Nothing scheduled today.</div>
          ) : (byDay[today.toDateString()] ?? []).map((e) => (
            <div key={e.id} className="px-4 py-3 flex items-center gap-3">
              <div className="w-16 text-xs font-mono text-slate-500">
                {new Date(e.when).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
              </div>
              <div className="flex-1 min-w-0 text-sm text-slate-800 truncate">{e.title}</div>
              <StatusBadge status={e.status} />
            </div>
          ))}
        </div>
      </div>
    </Layout>
  );
}
