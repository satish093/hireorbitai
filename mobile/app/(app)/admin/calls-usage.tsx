import { Text, View } from 'react-native';
import { ScreenScroll, PageHeader, Banner } from '../../../src/components/ui/Screen';
import {
  Card,
  MetricTile,
  SectionHeader,
  DetailRow,
  Divider,
} from '../../../src/components/ui/Card';
import { SkeletonMetricGrid } from '../../../src/components/ui/States';
import { RouteGuard } from '../../../src/components/RouteGuard';
import { useApiQuery } from '../../../src/hooks/useApi';
import { OWNER_TIER } from '../../../src/types';
import { useTheme } from '../../../src/theme';

interface CallsUsage {
  hours_used?: number | null;
  hour_cap?: number | null;
  calls_count?: number | null;
  month?: string | null;
}

/**
 * Monthly call-hour budget — GET /calls-usage.
 *
 * OWNER_TIER, or a DEVELOPER with `calls_usage`.
 *
 * This is a real spend ceiling, not a vanity metric: it protects the Cloudflare
 * Realtime TURN free tier (1,000 GB egress/month). Once CALLS_MONTHLY_HOUR_CAP
 * is reached, POST /calls/offer returns 503 and calling stops working for the
 * whole workspace until the calendar month rolls over — so the remaining
 * headroom is the number that matters, and it is shown first.
 */
export default function CallsUsageScreen() {
  return (
    <RouteGuard allow={[...OWNER_TIER]} capability="calls_usage">
      <CallsUsageView />
    </RouteGuard>
  );
}

function CallsUsageView() {
  const { colors, spacing, fontSize, radius } = useTheme();

  const { data, loading, refreshing, error, onRefresh } = useApiQuery<CallsUsage>('/calls-usage');

  const used = data?.hours_used ?? 0;
  const cap = data?.hour_cap ?? 0;
  const remaining = cap > 0 ? Math.max(0, cap - used) : null;
  const pct = cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 0;
  const critical = pct >= 90;

  return (
    <ScreenScroll refreshing={refreshing} onRefresh={onRefresh} edges={[]}>
      <PageHeader title="Call usage" subtitle={data?.month ?? 'This month'} />

      {error ? <Banner tone="danger" message={error} /> : null}

      {loading && !data ? (
        <SkeletonMetricGrid count={3} />
      ) : (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
            <MetricTile
              label="Remaining"
              value={remaining === null ? '∞' : `${Math.round(remaining)}h`}
              tone={critical ? 'danger' : 'success'}
              hint={cap > 0 ? `of ${cap}h cap` : 'no cap set'}
            />
            <MetricTile label="Used" value={`${Math.round(used)}h`} />
            <MetricTile label="Calls" value={data?.calls_count ?? 0} />
          </View>

          {cap > 0 ? (
            <Card>
              <SectionHeader title="Budget" />
              <View
                style={{
                  height: 10,
                  borderRadius: radius.pill,
                  backgroundColor: colors.hover,
                  overflow: 'hidden',
                }}
              >
                <View
                  style={{
                    width: `${pct}%`,
                    height: '100%',
                    backgroundColor: critical
                      ? colors.danger
                      : pct >= 70
                        ? colors.warn
                        : colors.success,
                  }}
                />
              </View>
              <Text style={{ fontSize: fontSize.sm, color: colors.muted, marginTop: spacing.sm }}>
                {pct}% of this month&apos;s capacity used
              </Text>

              <View style={{ marginTop: spacing.md }}>
                <DetailRow label="Cap" value={`${cap} hours`} />
                <Divider />
                <DetailRow label="Resets" value="1st of next month (UTC)" />
              </View>
            </Card>
          ) : null}

          {critical ? (
            <Banner
              tone="danger"
              message="Nearly at the monthly cap. Once it's reached, starting a call returns 503 for everyone until the month rolls over."
            />
          ) : null}
        </>
      )}
    </ScreenScroll>
  );
}
