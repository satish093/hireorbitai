import { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Screen, Banner } from '../../src/components/ui/Screen';
import { PageTopBar } from '../../src/components/ui/TopBar';
import { Card, MetricTile, SectionHeader, DetailRow, Divider } from '../../src/components/ui/Card';
import type { MetricAccent } from '../../src/components/ui/Card';
import { BreakdownRow } from '../../src/components/ui/Charts';
import { Tabs } from '../../src/components/ui/Tabs';
import { SkeletonMetricGrid, EmptyState } from '../../src/components/ui/States';
import { RouteGuard } from '../../src/components/RouteGuard';
import { useApiQuery } from '../../src/hooks/useApi';
import { OPERATOR_TIER } from '../../src/types';
import { useTheme } from '../../src/theme';

/**
 * Reports — analytics across pipeline, recruiters, consultants, placements and
 * sources. OPERATOR_TIER + the `reports` flag (or a DEVELOPER with `reports`).
 *
 * Mirrors the web Reports page: a date-range control (7d/30d/90d/QTD/YTD +
 * "vs. prior period"), KPI cards with a coloured accent bar + trend delta, and a
 * scrollable tab strip per analytics section. Each section calls the same
 * range-aware endpoint the web uses (`/reports/{tab}?range=&compareToPrior=`)
 * and renders its `kpis`, `charts`, and `table` payload.
 *
 * ⚠️ HONESTY NOTE (carried from the web): some server metrics aren't wired yet;
 * anything the API omits shows as "—" — never invent a number here.
 */
export default function ReportsScreen() {
  return (
    <RouteGuard allow={[...OPERATOR_TIER]} capability="reports" feature="reports">
      <Reports />
    </RouteGuard>
  );
}

const TABS = [
  { key: 'pipeline', label: 'Pipeline' },
  { key: 'recruiters', label: 'Recruiters' },
  { key: 'consultants', label: 'Consultants' },
  { key: 'placements', label: 'Placements' },
  { key: 'sources', label: 'Sources' },
] as const;

const RANGES = [
  { key: '7d', label: '7d' },
  { key: '30d', label: '30d' },
  { key: '90d', label: '90d' },
  { key: 'qtd', label: 'QTD' },
  { key: 'ytd', label: 'YTD' },
] as const;

interface Kpi {
  label: string;
  value: string | number;
  delta?: string | null;
  trend?: 'up' | 'down' | null;
  positive?: boolean | null;
  helpText?: string | null;
}

interface ReportPayload {
  kpis?: Kpi[];
  charts?: Record<string, unknown>;
  table?: Record<string, unknown>[];
  [k: string]: unknown;
}

function Reports() {
  const { colors, spacing, fontSize } = useTheme();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('pipeline');
  const [range, setRange] = useState<(typeof RANGES)[number]['key']>('30d');
  const [compareToPrior, setCompareToPrior] = useState(false);

  const params = useMemo(() => ({ range, compareToPrior }), [range, compareToPrior]);
  const report = useApiQuery<ReportPayload>(`/reports/${tab}`, { channel: 'reports', params });

  return (
    <Screen edges={['top']}>
      <PageTopBar title="Reports" showBack />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          padding: spacing.lg,
          paddingBottom: spacing['4xl'] + insets.bottom,
          gap: spacing.md,
        }}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={!!report.refreshing}
            onRefresh={report.onRefresh}
            tintColor={colors.accent}
            colors={[colors.accent]}
          />
        }
      >
        <Text style={{ fontSize: fontSize.sm, color: colors.muted }}>
          Analytics across pipeline, recruiters, consultants, placements, sources, and AI usage.
        </Text>

        {/* Date-range control */}
        <Tabs
          items={RANGES.map((r) => ({ key: r.key, label: r.label }))}
          value={range}
          onChange={(k) => setRange(k as (typeof RANGES)[number]['key'])}
        />
        <Pressable
          onPress={() => setCompareToPrior((v) => !v)}
          accessibilityRole="switch"
          accessibilityState={{ checked: compareToPrior }}
          style={{
            alignSelf: 'flex-start',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            paddingVertical: 6,
            paddingHorizontal: 12,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: compareToPrior ? colors.accent : colors.border,
            backgroundColor: compareToPrior ? colors.accentSoft : 'transparent',
          }}
        >
          <View
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: compareToPrior ? colors.accent : colors.faint,
            }}
          />
          <Text
            style={{
              fontSize: fontSize.sm,
              fontWeight: '600',
              color: compareToPrior ? colors.accent : colors.muted,
            }}
          >
            vs. prior period
          </Text>
        </Pressable>

        {/* Section tabs */}
        <Tabs
          items={TABS.map((t) => ({ key: t.key, label: t.label }))}
          value={tab}
          onChange={(k) => setTab(k as (typeof TABS)[number]['key'])}
        />

        {report.error ? <Banner tone="danger" message={report.error} /> : null}

        {report.loading && !report.data ? (
          <SkeletonMetricGrid count={3} />
        ) : (
          <ReportBody data={report.data} />
        )}

        <Banner
          tone="info"
          message="Some metrics aren't wired to a data source yet on the server. Anything unavailable is shown as “—” rather than estimated."
        />
      </ScrollView>
    </Screen>
  );
}

function ReportBody({ data }: { data: ReportPayload | undefined }) {
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

  const kpis = Array.isArray(data.kpis) ? data.kpis : [];
  const charts = (data.charts ?? {}) as Record<string, unknown>;
  const table = Array.isArray(data.table) ? data.table : [];
  const palette = [
    colors.accent,
    colors.accent2,
    colors.success,
    colors.warn,
    colors.danger,
    colors.faint,
  ];

  return (
    <>
      {kpis.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
          {kpis.map((k, i) => (
            <MetricTile
              key={`${k.label}-${i}`}
              label={k.label}
              value={k.value === '' || k.value == null ? '—' : k.value}
              accent={kpiAccent(k, i)}
              delta={k.delta ?? undefined}
              up={k.trend === 'up'}
              hint={k.helpText ?? undefined}
            />
          ))}
        </View>
      ) : null}

      {/* Known chart shapes rendered as proportional breakdown bars. */}
      {Object.entries(charts).map(([key, value]) => {
        const rows = chartRows(key, value);
        if (!rows) return null;
        const total = Math.max(1, ...rows.map((r) => r.value));
        return (
          <Card key={key}>
            <SectionHeader title={humanise(key)} />
            <View style={{ gap: spacing.md }}>
              {rows.map((r, i) => (
                <BreakdownRow
                  key={`${r.label}-${i}`}
                  label={r.label}
                  value={r.value}
                  total={r.total ?? total}
                  color={palette[i % palette.length] ?? colors.accent}
                />
              ))}
            </View>
          </Card>
        );
      })}

      {table.length > 0 ? (
        <Card>
          <SectionHeader title="Breakdown" subtitle={`${table.length} rows`} />
          {table.slice(0, 40).map((row, i) => {
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
                  {entries.slice(1, 6).map(([k, v]) => (
                    <DetailRow key={k} label={humanise(k)} value={String(v)} />
                  ))}
                </View>
              </View>
            );
          })}
        </Card>
      ) : null}

      {kpis.length === 0 && Object.keys(charts).length === 0 && table.length === 0 ? (
        <Card>
          <EmptyState compact title="Nothing to show" description="No data for this period." />
        </Card>
      ) : null}
    </>
  );
}

/** Accent for a KPI tile: green when the move is good, red when bad, else brand. */
function kpiAccent(k: Kpi, i: number): MetricAccent {
  if (k.positive === true) return 'green';
  if (k.positive === false) return 'red';
  return ACCENTS[i % ACCENTS.length] ?? 'brand';
}

/** Normalise the known chart payloads into {label,value} rows; null if unknown. */
function chartRows(
  key: string,
  value: unknown,
): { label: string; value: number; total?: number }[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;

  // funnel: [{ stage, count, pct }]
  if (key === 'funnel') {
    const top = Math.max(1, ...value.map((s: any) => Number(s.count) || 0));
    return value.map((s: any) => ({
      label: String(s.stage ?? ''),
      value: Number(s.count) || 0,
      total: top,
    }));
  }
  // byClient: [ [label, value, color?] ]
  if (Array.isArray(value[0])) {
    return (value as any[]).map((r) => ({ label: String(r[0]), value: Number(r[1]) || 0 }));
  }
  // donut mix: [{ label, value }]
  if (value[0] && typeof value[0] === 'object' && 'label' in (value[0] as object)) {
    return (value as any[]).map((d) => ({ label: String(d.label), value: Number(d.value) || 0 }));
  }
  return null;
}

const ACCENTS: MetricAccent[] = ['brand', 'blue', 'green', 'amber'];

function humanise(key: string): string {
  const s = key.replace(/_/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
