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

// ── Types ──────────────────────────────────────────────────────────────────────

interface Totals {
  calls: number;
  input_tokens: number;
  output_tokens: number;
  cache_tokens: number;
  cost_usd: string;
}

interface FreeTotals {
  calls: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: string;
}

interface ByCall {
  call_name: string;
  provider?: string;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: string;
}

interface ByModel {
  model: string;
  provider?: string;
  calls: number;
  total_tokens: number;
  cost_usd: string;
}

interface SummaryData {
  days: number;
  totals: Totals;
  by_call: ByCall[];
  by_model: ByModel[];
  paid: { totals: Totals; by_call: ByCall[] };
  free: { totals: FreeTotals; by_call: ByCall[]; by_model: ByModel[] };
}

interface LogRow {
  id: string;
  call_name: string;
  model: string;
  provider: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cost_usd: string;
  created_at: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

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

const PROVIDER_COLORS: Record<string, string> = {
  anthropic: 'bg-purple-100 text-purple-700',
  gemini: 'bg-blue-100 text-blue-700',
  groq: 'bg-green-100 text-green-700',
  llamaparse: 'bg-orange-100 text-orange-700',
};

function ProviderBadge({ provider }: { provider: string }) {
  return (
    <span
      className={clsx(
        'inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
        PROVIDER_COLORS[provider] ?? 'bg-bg-sunken text-muted',
      )}
    >
      {provider}
    </span>
  );
}

// ── Paid tab ───────────────────────────────────────────────────────────────────

function PaidTab({
  summary,
  logRows,
  loading,
}: {
  summary: SummaryData | null;
  logRows: LogRow[];
  loading: boolean;
}) {
  const totals = summary?.paid.totals;
  const paidLogs = logRows.filter((r) => r.provider === 'anthropic');
  const byCallBars: BarRow[] = (summary?.paid.by_call ?? []).map((r) => [
    r.call_name,
    r.calls,
    fmtCost(r.cost_usd),
  ]);

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
        <DashboardCard
          label="Total Calls"
          value={loading ? '…' : (totals?.calls ?? 0)}
          hint="Anthropic API"
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

      <div className="grid gap-4 lg:grid-cols-2 mb-6">
        <div className="bg-surface rounded-xl border border-border p-4">
          <div className="text-sm font-semibold text-ink mb-3">Calls by Feature</div>
          <HorizontalBars data={byCallBars} />
        </div>
        <div className="bg-surface rounded-xl border border-border p-4">
          <div className="text-sm font-semibold text-ink mb-3">Calls by Model</div>
          {(summary?.by_model ?? []).filter((m) => m.model.startsWith('claude-')).length === 0 ? (
            <p className="text-sm text-muted">No paid API calls yet.</p>
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
                {(summary?.by_model ?? [])
                  .filter((m) => m.model.startsWith('claude-'))
                  .map((m) => (
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

      <div className="text-sm font-semibold text-ink mb-2">Recent Paid Calls</div>
      <DataTable
        loading={loading}
        empty="No Anthropic API calls recorded yet."
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
        rows={paidLogs}
      />
    </>
  );
}

// ── Free tab ───────────────────────────────────────────────────────────────────

function FreeTab({
  summary,
  logRows,
  loading,
}: {
  summary: SummaryData | null;
  logRows: LogRow[];
  loading: boolean;
}) {
  const ft = summary?.free.totals;
  const groqCalls = summary?.free.by_call.filter((r) => r.provider === 'groq') ?? [];
  const geminiCalls = summary?.free.by_call.filter((r) => r.provider === 'gemini') ?? [];
  const groqModels = summary?.free.by_model.filter((m) => m.provider === 'groq') ?? [];
  const geminiModels = summary?.free.by_model.filter((m) => m.provider === 'gemini') ?? [];
  const llamaModels = summary?.free.by_model.filter((m) => m.provider === 'llamaparse') ?? [];
  const llamaCalls = llamaModels.reduce((s, m) => s + m.calls, 0);

  const groqBars: BarRow[] = groqCalls.map((r) => [r.call_name, r.calls, `${r.calls} calls`]);
  const geminiBars: BarRow[] = geminiCalls.map((r) => [r.call_name, r.calls, `${r.calls} calls`]);
  const totalFreeTokens = (ft?.input_tokens ?? 0) + (ft?.output_tokens ?? 0);

  const freeLogs = logRows
    .filter((r) => r.provider !== 'anthropic')
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return (
    <>
      {/* KPI strip */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <DashboardCard
          label="Free Calls"
          value={loading ? '…' : (ft?.calls ?? 0)}
          hint="Groq + Gemini + LlamaParse"
          accent="brand"
        />
        <DashboardCard
          label="Total Tokens"
          value={loading ? '…' : fmt(totalFreeTokens)}
          hint="Input + output"
          accent="blue"
        />
        <DashboardCard label="Cost" value="$0.0000" hint="Free tier — no billing" accent="green" />
      </div>

      {/* Provider info cards */}
      <div className="grid gap-4 lg:grid-cols-3 mb-6">
        {/* Groq */}
        <div className="bg-surface rounded-xl border border-border p-4">
          <div className="flex items-center gap-2 mb-2">
            <ProviderBadge provider="groq" />
            <span className="text-sm font-semibold text-ink">Groq</span>
          </div>
          <p className="text-xs text-muted mb-3">
            LLaMA 3.3 70B · 14,400 req/day free · Primary AI provider
          </p>
          {groqModels.length > 0 ? (
            groqModels.map((m) => (
              <div
                key={m.model}
                className="flex justify-between text-xs py-1.5 border-b border-border last:border-0"
              >
                <span className="font-mono text-ink-2 truncate">{m.model}</span>
                <span className="tabular-nums text-muted shrink-0 ml-2">
                  {fmt(m.calls)} calls · {fmt(m.total_tokens)} tokens
                </span>
              </div>
            ))
          ) : (
            <p className="text-xs text-muted italic">No calls yet</p>
          )}
        </div>

        {/* Gemini */}
        <div className="bg-surface rounded-xl border border-border p-4">
          <div className="flex items-center gap-2 mb-2">
            <ProviderBadge provider="gemini" />
            <span className="text-sm font-semibold text-ink">Gemini</span>
          </div>
          <p className="text-xs text-muted mb-3">
            2.5 Flash · 10,000 RPD free · Fallback when Groq unavailable
          </p>
          {geminiModels.length > 0 ? (
            geminiModels.map((m) => (
              <div
                key={m.model}
                className="flex justify-between text-xs py-1.5 border-b border-border last:border-0"
              >
                <span className="font-mono text-ink-2 truncate">{m.model}</span>
                <span className="tabular-nums text-muted shrink-0 ml-2">
                  {fmt(m.calls)} calls · {fmt(m.total_tokens)} tokens
                </span>
              </div>
            ))
          ) : (
            <p className="text-xs text-muted italic">No calls yet</p>
          )}
        </div>

        {/* LlamaParse */}
        <div className="bg-surface rounded-xl border border-border p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-orange-100 text-orange-700">
              llama
            </span>
            <span className="text-sm font-semibold text-ink">LlamaParse</span>
          </div>
          <p className="text-xs text-muted mb-3">
            PDF extraction · 10,000 credits/month · Primary resume parser
          </p>
          <div className="space-y-1.5 text-xs">
            <div className="flex justify-between">
              <span className="text-muted">Plan</span>
              <span className="text-success font-semibold">Free</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Quota</span>
              <span className="text-ink">10,000 pages/mo</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">PDFs parsed</span>
              <span className="tabular-nums text-ink font-medium">
                {loading ? '…' : llamaCalls}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Feature breakdowns */}
      <div className="grid gap-4 lg:grid-cols-2 mb-6">
        <div className="bg-surface rounded-xl border border-border p-4">
          <div className="flex items-center gap-2 mb-3">
            <ProviderBadge provider="groq" />
            <span className="text-sm font-semibold text-ink">Groq — Calls by Feature</span>
          </div>
          {groqBars.length === 0 ? (
            <p className="text-sm text-muted">No Groq calls yet.</p>
          ) : (
            <HorizontalBars data={groqBars} />
          )}
        </div>
        <div className="bg-surface rounded-xl border border-border p-4">
          <div className="flex items-center gap-2 mb-3">
            <ProviderBadge provider="gemini" />
            <span className="text-sm font-semibold text-ink">Gemini — Calls by Feature</span>
          </div>
          {geminiBars.length === 0 ? (
            <p className="text-sm text-muted">No Gemini calls yet.</p>
          ) : (
            <HorizontalBars data={geminiBars} />
          )}
        </div>
      </div>

      {/* Recent free calls */}
      <div className="text-sm font-semibold text-ink mb-2">Recent Free Calls</div>
      <DataTable
        loading={loading}
        empty="No free-tier AI calls recorded yet."
        columns={[
          { key: 'call_name', header: 'Feature', render: (r: LogRow) => r.call_name },
          {
            key: 'provider',
            header: 'Provider',
            render: (r: LogRow) => <ProviderBadge provider={r.provider} />,
          },
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
            key: 'created_at',
            header: 'Time',
            render: (r: LogRow) => (
              <span className="text-muted text-xs">{fmtTime(r.created_at)}</span>
            ),
          },
        ]}
        rows={freeLogs}
      />
    </>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export function AIUsage() {
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30);
  const [tab, setTab] = useState<'free' | 'paid'>('free');
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

  return (
    <Layout title="AI Usage">
      <PageHeader
        title="AI Usage"
        description="Token consumption and cost across paid and free providers."
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

      {/* Tabs */}
      <div className="flex gap-0 mb-6 border-b border-border">
        {(['free', 'paid'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={clsx(
              'px-5 py-2.5 text-sm font-medium border-b-2 -mb-px transition',
              tab === t
                ? 'border-accent text-accent'
                : 'border-transparent text-muted hover:text-ink',
            )}
          >
            {t === 'free' ? '🟢 Free Models' : '💳 Paid Models'}
          </button>
        ))}
      </div>

      {tab === 'paid' ? (
        <PaidTab summary={summary} logRows={logRows} loading={loading} />
      ) : (
        <FreeTab summary={summary} logRows={logRows} loading={loading} />
      )}
    </Layout>
  );
}
