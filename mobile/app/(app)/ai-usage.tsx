import { useMemo } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Screen, Banner } from '../../src/components/ui/Screen';
import { PageTopBar } from '../../src/components/ui/TopBar';
import { Card, MetricTile, SectionHeader, Divider } from '../../src/components/ui/Card';
import { Pill } from '../../src/components/ui/Pill';
import { BreakdownRow } from '../../src/components/ui/Charts';
import { SkeletonMetricGrid, SkeletonList, EmptyState } from '../../src/components/ui/States';
import { RouteGuard } from '../../src/components/RouteGuard';
import { useApiQuery, useApiList } from '../../src/hooks/useApi';
import { MANAGER_TIER } from '../../src/types';
import { useTheme } from '../../src/theme';
import { compactNumber, relativeDate } from '../../src/utils/format';

interface UsageSummary {
  total_cost_usd?: number | null;
  total_tokens?: number | null;
  request_count?: number | null;
  period?: string | null;
}

interface UsageLog {
  id: string;
  provider?: string | null;
  model?: string | null;
  feature?: string | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  cost_usd?: number | null;
  created_at: string;
}

/**
 * AI usage — GET /ai-usage/summary and /ai-usage/logs.
 *
 * MANAGER_TIER, or a DEVELOPER with `ai_usage`.
 *
 * Cost is shown to 4 decimal places rather than rounded to cents: individual
 * calls are fractions of a cent, and rounding would render most rows as $0.00,
 * which hides exactly the per-feature drift this screen exists to catch.
 */
export default function AIUsageScreen() {
  return (
    <RouteGuard allow={[...MANAGER_TIER]} capability="ai_usage">
      <AIUsage />
    </RouteGuard>
  );
}

function AIUsage() {
  const { colors, spacing, fontSize } = useTheme();
  const insets = useSafeAreaInsets();

  const summary = useApiQuery<UsageSummary>('/ai-usage/summary');
  const logs = useApiList<UsageLog>('/ai-usage/logs');

  const refreshing = summary.refreshing || logs.refreshing;
  const onRefresh = () => {
    void summary.refetch();
    void logs.refetch();
  };

  // Breakdown of calls by model (falling back to provider) — computed client-side
  // from the log list, since there is no dedicated aggregate endpoint. Top 6 by
  // volume; the rest fold into "Other" so the bars stay readable.
  const breakdown = useMemo(() => {
    const byModel = new Map<string, number>();
    for (const log of logs.items) {
      const key = log.model ?? log.provider ?? 'Unknown';
      byModel.set(key, (byModel.get(key) ?? 0) + 1);
    }
    const rows = [...byModel.entries()].sort((a, b) => b[1] - a[1]);
    const top = rows.slice(0, 6);
    const restTotal = rows.slice(6).reduce((s, [, v]) => s + v, 0);
    if (restTotal > 0) top.push(['Other', restTotal]);
    const total = rows.reduce((s, [, v]) => s + v, 0);
    const palette = [
      colors.accent,
      colors.accent2,
      colors.success,
      colors.warn,
      colors.danger,
      colors.faint,
      colors.ink2,
    ];
    return { rows: top, total, palette };
  }, [logs.items, colors]);

  return (
    <Screen>
      <PageTopBar title="AI usage" subtitle={summary.data?.period ?? 'This month'} />
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
        {summary.error ? <Banner tone="danger" message={summary.error} /> : null}

        {summary.loading && !summary.data ? (
          <SkeletonMetricGrid count={3} />
        ) : (
          (() => {
            // Postgres returns NUMERIC/BIGINT columns as STRINGS via node-postgres,
            // so coerce before any Number method (.toFixed on a string throws).
            const spend = Number(summary.data?.total_cost_usd ?? 0) || 0;
            const tokens = Number(summary.data?.total_tokens ?? 0) || 0;
            const requests = Number(summary.data?.request_count ?? 0) || 0;
            return (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
                <MetricTile
                  label="Spend"
                  value={`$${spend.toFixed(2)}`}
                  tone={spend > 50 ? 'warn' : 'default'}
                  accent={spend > 50 ? 'red' : 'amber'}
                />
                <MetricTile label="Tokens" value={compactNumber(tokens)} accent="blue" />
                <MetricTile label="Requests" value={requests} accent="brand" />
              </View>
            );
          })()
        )}

        {breakdown.total > 0 ? (
          <Card>
            <SectionHeader title="Calls by model" subtitle={`${breakdown.total} logged`} />
            <View style={{ gap: spacing.md }}>
              {breakdown.rows.map(([label, value], i) => (
                <BreakdownRow
                  key={label}
                  label={label}
                  value={value}
                  total={breakdown.total}
                  color={breakdown.palette[i % breakdown.palette.length] ?? colors.accent}
                />
              ))}
            </View>
          </Card>
        ) : null}

        <Card padded={false}>
          <View style={{ padding: spacing.lg, paddingBottom: spacing.sm }}>
            <SectionHeader title="Recent calls" />
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
                      {log.feature?.replace(/_/g, ' ') ?? 'AI call'}
                    </Text>
                    <Text style={{ fontSize: fontSize.xs, color: colors.faint, marginTop: 2 }}>
                      {log.model ?? log.provider ?? '—'} · {relativeDate(log.created_at)}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    <Text style={{ fontSize: fontSize.sm, fontWeight: '600', color: colors.ink }}>
                      ${(Number(log.cost_usd ?? 0) || 0).toFixed(4)}
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
