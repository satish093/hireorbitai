import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { ScreenScroll, PageHeader, Banner } from '../../src/components/ui/Screen';
import { Card, MetricTile, SectionHeader, DetailRow, Divider } from '../../src/components/ui/Card';
import { SkeletonMetricGrid, EmptyState } from '../../src/components/ui/States';
import { RouteGuard } from '../../src/components/RouteGuard';
import { useApiQuery } from '../../src/hooks/useApi';
import { OPERATOR_TIER } from '../../src/types';
import { useTheme } from '../../src/theme';

/**
 * Analytics.
 *
 * OPERATOR_TIER + the `reports` flag, or a DEVELOPER with the `reports`
 * capability.
 *
 * The web renders 8 tabs of charts. Charts on a phone are mostly unreadable, so
 * each report becomes a stack of labelled figures — same numbers, no
 * horizontal-scrolling axis. Tabs become a segmented scroller.
 *
 * ⚠️ HONESTY NOTE, carried over from the web: several metrics in this module are
 * not wired to a data source yet (bench utilisation, median TC, revenue,
 * 90-day retention, ingest latency). reports.controller.ts marks them TODO and
 * the web's useReportData.ts still falls back to MOCK values. This screen shows
 * only what the API actually returns and renders an explicit "not available"
 * rather than inventing a number — do not add placeholder figures here.
 */
export default function ReportsScreen() {
  return (
    <RouteGuard allow={[...OPERATOR_TIER]} capability="reports" feature="reports">
      <Reports />
    </RouteGuard>
  );
}

const TABS = [
  { key: 'manager-summary', label: 'Summary' },
  { key: 'recruiter-performance', label: 'Recruiters' },
  { key: 'consultant-pipeline', label: 'Pipeline' },
  { key: 'placement-analytics', label: 'Placements' },
  { key: 'daily', label: 'Daily' },
  { key: 'user-time', label: 'Time in app' },
] as const;

function Reports() {
  const { colors, spacing, fontSize, radius } = useTheme();
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('manager-summary');

  const report = useApiQuery<Record<string, unknown>>(`/reports/${tab}`, { channel: 'reports' });

  return (
    <ScreenScroll refreshing={report.refreshing} onRefresh={report.onRefresh}>
      <PageHeader title="Analytics" />

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: spacing.sm, paddingVertical: 2 }}
      >
        {TABS.map((t) => {
          const active = t.key === tab;
          return (
            <Pressable
              key={t.key}
              onPress={() => setTab(t.key)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              style={{
                paddingHorizontal: spacing.md,
                height: 44,
                justifyContent: 'center',
                borderRadius: radius.pill,
                backgroundColor: active ? colors.ink : colors.surface,
                borderWidth: 1,
                borderColor: active ? colors.ink : colors.border,
              }}
            >
              <Text
                style={{
                  color: active ? colors.bg : colors.ink2,
                  fontSize: fontSize.sm,
                  fontWeight: '600',
                }}
              >
                {t.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {report.error ? <Banner tone="danger" message={report.error} /> : null}

      {report.loading && !report.data ? (
        <SkeletonMetricGrid count={4} />
      ) : (
        <ReportBody data={report.data} />
      )}

      <Banner
        tone="info"
        message="Some metrics in this module aren't wired to a data source yet on the server. Anything unavailable is shown as “—” rather than estimated."
      />
    </ScreenScroll>
  );
}

/**
 * Renders whatever the endpoint returned.
 *
 * Report payloads differ per tab and several are still being shaped
 * server-side, so this walks the object instead of hard-coding a schema per
 * tab: scalars become metric tiles, arrays of objects become labelled rows.
 * A tab that gains a field starts showing it with no client change.
 */
function ReportBody({ data }: { data: Record<string, unknown> | undefined }) {
  const { colors, spacing, fontSize } = useTheme();

  if (!data || Object.keys(data).length === 0) {
    return (
      <Card>
        <EmptyState
          compact
          title="Nothing to show"
          description="This report returned no data for the current period."
        />
      </Card>
    );
  }

  const scalars: [string, string | number][] = [];
  const tables: [string, Record<string, unknown>[]][] = [];

  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'number' || typeof value === 'string') {
      scalars.push([key, value]);
    } else if (Array.isArray(value) && value.every((v) => v && typeof v === 'object')) {
      tables.push([key, value as Record<string, unknown>[]]);
    }
  }

  return (
    <>
      {scalars.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
          {scalars.map(([key, value]) => (
            <MetricTile key={key} label={humanise(key)} value={value === '' ? '—' : value} />
          ))}
        </View>
      ) : null}

      {tables.map(([key, rows]) => (
        <Card key={key}>
          <SectionHeader title={humanise(key)} subtitle={`${rows.length} rows`} />
          {rows.length === 0 ? (
            <EmptyState compact title="No rows" />
          ) : (
            rows.slice(0, 25).map((row, i) => {
              const entries = Object.entries(row).filter(
                ([, v]) => typeof v === 'string' || typeof v === 'number',
              );
              const [firstKey, firstValue] = entries[0] ?? ['', ''];
              return (
                <View key={i}>
                  {i > 0 ? <Divider /> : null}
                  <View style={{ paddingVertical: spacing.sm }}>
                    <Text
                      numberOfLines={1}
                      style={{ fontSize: fontSize.base, fontWeight: '600', color: colors.ink }}
                    >
                      {String(firstValue || humanise(firstKey))}
                    </Text>
                    {entries.slice(1, 5).map(([k, v]) => (
                      <DetailRow key={k} label={humanise(k)} value={String(v)} />
                    ))}
                  </View>
                </View>
              );
            })
          )}
        </Card>
      ))}
    </>
  );
}

/** snake_case → "Snake case". */
function humanise(key: string): string {
  const s = key.replace(/_/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
