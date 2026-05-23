import { useEffect, useState } from 'react';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import { Layout } from '../components/Layout';
import { PageHeader } from '../components/PageHeader';
import { DashboardCard } from '../components/DashboardCard';
import { DataTable } from '../components/DataTable';
import { HorizontalBars } from '../components/reports/charts/HorizontalBars';
import { api } from '../services/api';
import type { BarRow } from '../components/reports/types';

interface Totals {
  calls: number;
  input_tokens: number;
  output_tokens: number;
  cache_tokens: number;
  cost_usd: string;
}

interface ByCall {
  call_name: string;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: string;
}

interface ByModel {
  model: string;
  calls: number;
  total_tokens: number;
  cost_usd: string;
}

interface SummaryData {
  days: number;
  totals: Totals;
  by_call: ByCall[];
  by_model: ByModel[];
}

interface LogRow {
  id: string;
  call_name: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cost_usd: string;
  created_at: string;
}

const PERIODS = [7, 30, 90] as const;

function fmt(n: number): string {
  return n.toLocaleString();
}

function fmtCost(v: string | number): string {
  return `$${Number(v).toFixed(4)}`;
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function AIUsage() {
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30);
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [logRows, setLogRows] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([api.get(`/ai-usage/summary?days=${days}`), api.get('/ai-usage/logs?limit=200')])
      .then(([s, l]) => {
        setSummary(s.data);
        setLogRows(l.data ?? []);
      })
      .catch((e) => toast.error(e?.response?.data?.error ?? 'Failed to load AI usage'))
      .finally(() => setLoading(false));
  }, [days]);

  const totals = summary?.totals;

  const byCallBars: BarRow[] = (summary?.by_call ?? []).map((r) => [
    r.call_name,
    r.calls,
    fmtCost(r.cost_usd),
  ]);

  return (
    <Layout title="AI Usage">
      <PageHeader
        title="AI Token Usage"
        description="Token consumption and estimated cost per Anthropic API call."
        action={
          <div className="flex gap-1">
            {PERIODS.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDays(d)}
                className={clsx(
                  'px-3 py-1 rounded-lg text-sm font-medium transition',
                  days === d
                    ? 'bg-ink text-surface'
                    : 'text-muted hover:text-ink hover:bg-bg-sunken',
                )}
              >
                {d}d
              </button>
            ))}
          </div>
        }
      />

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
        <DashboardCard
          label="Total Calls"
          value={totals?.calls ?? 0}
          hint={`Last ${days} days`}
          accent="brand"
        />
        <DashboardCard
          label="Input Tokens"
          value={loading ? '…' : fmt(totals?.input_tokens ?? 0)}
          accent="blue"
        />
        <DashboardCard
          label="Output Tokens"
          value={loading ? '…' : fmt(totals?.output_tokens ?? 0)}
          accent="blue"
        />
        <DashboardCard
          label="Cache Tokens"
          value={loading ? '…' : fmt(totals?.cache_tokens ?? 0)}
          accent="slate"
        />
        <DashboardCard
          label="Est. Cost (USD)"
          value={loading ? '…' : fmtCost(totals?.cost_usd ?? 0)}
          hint="Approximate — see aiPricing.ts"
          accent="amber"
        />
      </div>

      {/* Breakdowns */}
      <div className="grid gap-4 lg:grid-cols-2 mb-6">
        {/* By feature / call name */}
        <div className="bg-surface rounded-xl border border-border p-4">
          <div className="text-sm font-semibold text-ink mb-3">Calls by Feature</div>
          <HorizontalBars data={byCallBars} />
        </div>

        {/* By model */}
        <div className="bg-surface rounded-xl border border-border p-4">
          <div className="text-sm font-semibold text-ink mb-3">Calls by Model</div>
          {(summary?.by_model ?? []).length === 0 ? (
            <p className="text-sm text-muted">No data yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-border">
                  <th className="pb-2 font-medium">Model</th>
                  <th className="pb-2 font-medium text-right">Calls</th>
                  <th className="pb-2 font-medium text-right">Tokens</th>
                  <th className="pb-2 font-medium text-right">Cost</th>
                </tr>
              </thead>
              <tbody>
                {(summary?.by_model ?? []).map((m) => (
                  <tr key={m.model} className="border-b border-border last:border-0">
                    <td className="py-2 font-mono text-xs text-ink-2 truncate max-w-[160px]">
                      {m.model}
                    </td>
                    <td className="py-2 text-right tabular-nums">{fmt(m.calls)}</td>
                    <td className="py-2 text-right tabular-nums">{fmt(m.total_tokens)}</td>
                    <td className="py-2 text-right tabular-nums font-mono text-xs">
                      {fmtCost(m.cost_usd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Recent call log */}
      <div className="text-sm font-semibold text-ink mb-2">Recent Calls</div>
      <DataTable
        loading={loading}
        empty="No AI calls recorded yet."
        columns={[
          { key: 'call_name', header: 'Feature', render: (r: LogRow) => r.call_name },
          {
            key: 'model',
            header: 'Model',
            render: (r: LogRow) => <span className="font-mono text-xs text-ink-2">{r.model}</span>,
          },
          {
            key: 'input_tokens',
            header: 'Input',
            align: 'right' as const,
            render: (r: LogRow) => fmt(r.input_tokens),
          },
          {
            key: 'output_tokens',
            header: 'Output',
            align: 'right' as const,
            render: (r: LogRow) => fmt(r.output_tokens),
          },
          {
            key: 'cache_read_tokens',
            header: 'Cache',
            align: 'right' as const,
            render: (r: LogRow) => fmt(r.cache_read_tokens),
          },
          {
            key: 'cost_usd',
            header: 'Cost',
            align: 'right' as const,
            render: (r: LogRow) => <span className="font-mono text-xs">{fmtCost(r.cost_usd)}</span>,
          },
          {
            key: 'created_at',
            header: 'Time',
            render: (r: LogRow) => (
              <span className="text-muted text-xs">{fmtTime(r.created_at)}</span>
            ),
          },
        ]}
        rows={logRows}
      />
    </Layout>
  );
}
