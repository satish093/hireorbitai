import { Text, View } from 'react-native';
import { ScreenScroll, PageHeader, Banner } from '../../src/components/ui/Screen';
import { Card, MetricTile, SectionHeader, Divider } from '../../src/components/ui/Card';
import { Pill } from '../../src/components/ui/Pill';
import { SkeletonMetricGrid, SkeletonList, EmptyState } from '../../src/components/ui/States';
import { RouteGuard } from '../../src/components/RouteGuard';
import { useApiQuery, useApiList } from '../../src/hooks/useApi';
import { MANAGER_TIER } from '../../src/types';
import { useTheme } from '../../src/theme';
import { compactNumber } from '../../src/utils/format';
import { relativeDate } from './jobs';

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

  const summary = useApiQuery<UsageSummary>('/ai-usage/summary');
  const logs = useApiList<UsageLog>('/ai-usage/logs');

  const refreshing = summary.refreshing || logs.refreshing;
  const onRefresh = () => {
    void summary.refetch();
    void logs.refetch();
  };

  return (
    <ScreenScroll refreshing={refreshing} onRefresh={onRefresh}>
      <PageHeader title="AI usage" subtitle={summary.data?.period ?? 'This month'} />

      {summary.error ? <Banner tone="danger" message={summary.error} /> : null}

      {summary.loading && !summary.data ? (
        <SkeletonMetricGrid count={3} />
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
          <MetricTile
            label="Spend"
            value={`$${(summary.data?.total_cost_usd ?? 0).toFixed(2)}`}
            tone={(summary.data?.total_cost_usd ?? 0) > 50 ? 'warn' : 'default'}
          />
          <MetricTile label="Tokens" value={compactNumber(summary.data?.total_tokens ?? 0)} />
          <MetricTile label="Requests" value={summary.data?.request_count ?? 0} />
        </View>
      )}

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
                    ${(log.cost_usd ?? 0).toFixed(4)}
                  </Text>
                  {log.provider ? <Pill label={log.provider} tone="neutral" size="sm" /> : null}
                </View>
              </View>
            </View>
          ))
        )}
      </Card>
    </ScreenScroll>
  );
}

// compactNumber (Intl-free) replaces the old Intl.NumberFormat compact notation.
