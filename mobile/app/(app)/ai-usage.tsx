import { useMemo, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Screen, Banner } from '../../src/components/ui/Screen';
import { PageTopBar } from '../../src/components/ui/TopBar';
import { Card, MetricTile, SectionHeader, Divider } from '../../src/components/ui/Card';
import { Pill } from '../../src/components/ui/Pill';
import { BreakdownRow } from '../../src/components/ui/Charts';
import { Tabs } from '../../src/components/ui/Tabs';
import { SkeletonMetricGrid, SkeletonList, EmptyState } from '../../src/components/ui/States';
import { RouteGuard } from '../../src/components/RouteGuard';
import { useApiQuery, useApiList } from '../../src/hooks/useApi';
import { MANAGER_TIER } from '../../src/types';
import { useTheme } from '../../src/theme';
import { compactNumber, relativeDate } from '../../src/utils/format';

/**
 * AI usage — GET /ai-usage/summary?days= and /ai-usage/logs?provider=.
 *
 * MANAGER_TIER, or a DEVELOPER with `ai_usage`. Mirrors the web AI Usage page:
 * a 7d/30d/90d range, a Free Models / Paid Models split, and per-tab KPI cards.
 *
 * Free providers = Groq + Gemini + LlamaParse (model NOT LIKE 'claude-%'); the
 * only paid provider is Anthropic (model LIKE 'claude-%'). The server derives
 * the split; the client just reads summary.free / summary.paid. Counts + tokens
 * come back as JS numbers (::int); only cost_usd is a string (::numeric).
 */
export default function AIUsageScreen() {
  return (
    <RouteGuard allow={[...MANAGER_TIER]} capability="ai_usage">
      <AIUsage />
    </RouteGuard>
  );
}

interface Totals {
  calls?: number | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_tokens?: number | null;
  cost_usd?: number | string | null;
}
interface ByModel {
  model?: string | null;
  provider?: string | null;
  calls?: number | null;
  total_tokens?: number | null;
}
interface Summary {
  days?: number;
  totals?: Totals;
  by_model?: ByModel[];
  paid?: { totals?: Totals };
  free?: { totals?: Totals; by_model?: ByModel[] };
}
interface LogRow {
  id: string;
  call_name?: string | null;
  model?: string | null;
  provider?: string | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  cost_usd?: number | string | null;
  created_at: string;
}

const RANGES = [
  { key: '7', label: '7d' },
  { key: '30', label: '30d' },
  { key: '90', label: '90d' },
];

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function AIUsage() {
  const { colors, spacing, fontSize } = useTheme();
  const insets = useSafeAreaInsets();
  const [days, setDays] = useState('30');
  const [tab, setTab] = useState<'free' | 'paid'>('free');

  const summary = useApiQuery<Summary>('/ai-usage/summary', { params: { days } });
  const logs = useApiList<LogRow>('/ai-usage/logs', { params: { provider: tab, limit: 100 } });

  const refreshing = summary.refreshing || logs.refreshing;
  const onRefresh = () => {
    void summary.refetch();
    void logs.refetch();
  };

  const free = summary.data?.free?.totals;
  const paid = summary.data?.paid?.totals;

  // Calls-by-model breakdown for the active tab.
  const breakdown = useMemo(() => {
    const rows =
      tab === 'free'
        ? (summary.data?.free?.by_model ?? [])
        : (summary.data?.by_model ?? []).filter((m) => (m.model ?? '').startsWith('claude-'));
    const mapped = rows
      .map((m) => ({ label: m.model ?? m.provider ?? 'Unknown', value: num(m.calls) }))
      .filter((r) => r.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);
    const total = Math.max(1, ...mapped.map((r) => r.value));
    return { rows: mapped, total };
  }, [summary.data, tab]);

  const palette = [
    colors.accent,
    colors.accent2,
    colors.success,
    colors.warn,
    colors.danger,
    colors.faint,
  ];

  return (
    <Screen edges={['top']}>
      <PageTopBar title="AI Usage" showBack />
      <ScrollView
        style={{ flex: 1 }}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          padding: spacing.lg,
          paddingBottom: spacing['4xl'] + insets.bottom,
          gap: spacing.lg,
        }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.accent}
            colors={[colors.accent]}
          />
        }
      >
        <Text style={{ fontSize: fontSize.sm, color: colors.muted }}>
          Token consumption and cost across paid and free providers.
        </Text>

        <Tabs items={RANGES} value={days} onChange={setDays} />
        <Tabs
          items={[
            { key: 'free', label: '🟢 Free Models' },
            { key: 'paid', label: '💳 Paid Models' },
          ]}
          value={tab}
          onChange={(k) => setTab(k as 'free' | 'paid')}
        />

        {summary.error ? <Banner tone="danger" message={summary.error} /> : null}

        {summary.loading && !summary.data ? (
          <SkeletonMetricGrid count={3} />
        ) : tab === 'free' ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
            <MetricTile
              label="Free calls"
              value={num(free?.calls)}
              hint="Groq + Gemini + LlamaParse"
              accent="brand"
            />
            <MetricTile
              label="Total tokens"
              value={compactNumber(num(free?.input_tokens) + num(free?.output_tokens))}
              hint="Input + output"
              accent="blue"
            />
            <MetricTile
              label="Cost"
              value="$0.0000"
              hint="Free tier — no billing"
              tone="success"
              accent="green"
            />
          </View>
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
            <MetricTile
              label="Calls"
              value={num(paid?.calls)}
              hint="Anthropic API"
              accent="brand"
            />
            <MetricTile
              label="Input tokens"
              value={compactNumber(num(paid?.input_tokens))}
              accent="blue"
            />
            <MetricTile
              label="Output tokens"
              value={compactNumber(num(paid?.output_tokens))}
              accent="blue"
            />
            <MetricTile
              label="Cache tokens"
              value={compactNumber(num(paid?.cache_tokens))}
              accent="slate"
            />
            <MetricTile
              label="Est. cost (USD)"
              value={`$${num(paid?.cost_usd).toFixed(4)}`}
              hint="Approximate"
              tone={num(paid?.cost_usd) > 50 ? 'warn' : 'default'}
              accent="amber"
            />
          </View>
        )}

        {breakdown.rows.length > 0 ? (
          <Card>
            <SectionHeader title="Calls by model" />
            <View style={{ gap: spacing.md }}>
              {breakdown.rows.map((r, i) => (
                <BreakdownRow
                  key={r.label}
                  label={r.label}
                  value={r.value}
                  total={breakdown.total}
                  color={palette[i % palette.length] ?? colors.accent}
                />
              ))}
            </View>
          </Card>
        ) : null}

        <Card padded={false}>
          <View style={{ padding: spacing.lg, paddingBottom: spacing.sm }}>
            <SectionHeader title={tab === 'free' ? 'Recent free calls' : 'Recent paid calls'} />
          </View>

          {logs.loading && logs.items.length === 0 ? (
            <View style={{ padding: spacing.lg }}>
              <SkeletonList count={4} />
            </View>
          ) : logs.items.length === 0 ? (
            <View style={{ paddingBottom: spacing.lg }}>
              <EmptyState compact title="No AI calls logged" />
            </View>
          ) : (
            logs.items.slice(0, 50).map((log, i) => (
              <View key={log.id}>
                {i > 0 ? <Divider inset={spacing.lg} /> : null}
                <View
                  style={{
                    paddingHorizontal: spacing.lg,
                    paddingVertical: spacing.md,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: spacing.md,
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text
                      numberOfLines={1}
                      style={{ fontSize: fontSize.base, color: colors.ink, fontWeight: '600' }}
                    >
                      {log.call_name?.replace(/_/g, ' ') ?? 'AI call'}
                    </Text>
                    <Text style={{ fontSize: fontSize.xs, color: colors.faint, marginTop: 2 }}>
                      {log.model ?? log.provider ?? '—'} · {relativeDate(log.created_at)}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    <Text style={{ fontSize: fontSize.sm, fontWeight: '600', color: colors.ink }}>
                      ${num(log.cost_usd).toFixed(4)}
                    </Text>
                    {log.provider ? <Pill label={log.provider} tone="neutral" size="sm" /> : null}
                  </View>
                </View>
              </View>
            ))
          )}
        </Card>
      </ScrollView>
    </Screen>
  );
}
