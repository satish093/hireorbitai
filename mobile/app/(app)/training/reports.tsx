import { Text, View } from 'react-native';
import { ScreenScroll, PageHeader, Banner } from '../../../src/components/ui/Screen';
import { Card, MetricTile, SectionHeader, Divider } from '../../../src/components/ui/Card';
import { Pill } from '../../../src/components/ui/Pill';
import { SkeletonMetricGrid, EmptyState } from '../../../src/components/ui/States';
import { RouteGuard } from '../../../src/components/RouteGuard';
import { useApiList } from '../../../src/hooks/useApi';
import { MANAGER_TIER } from '../../../src/types';
import { useTheme } from '../../../src/theme';

interface ComplianceRow {
  user_id?: string;
  full_name?: string | null;
  email?: string | null;
  assigned?: number | null;
  completed?: number | null;
  overdue?: number | null;
  compliance_percent?: number | null;
}

/**
 * Training compliance — GET /training/compliance. MANAGER_TIER.
 *
 * The web calls this "Reports"; the data underneath is a compliance roster, so
 * that is what is shown. This module has real regulatory weight — I-983 and
 * security-awareness training are tracked here — which is why the roll-up leads
 * with the number of people who are NOT compliant rather than an average.
 */
export default function TrainingReportsScreen() {
  return (
    <RouteGuard allow={[...MANAGER_TIER]} feature="training">
      <TrainingReports />
    </RouteGuard>
  );
}

function TrainingReports() {
  const { colors, spacing, fontSize, radius } = useTheme();

  const { items, loading, refreshing, error, onRefresh } = useApiList<ComplianceRow>(
    '/training/compliance',
    { channel: 'training' },
  );

  // Explicit accumulator type — without it TS infers ComplianceRow from the
  // element type and rejects `nonCompliant`, which only exists on the roll-up.
  interface Totals {
    assigned: number;
    completed: number;
    overdue: number;
    nonCompliant: number;
  }

  const totals = items.reduce<Totals>(
    (acc, r) => {
      acc.assigned += r.assigned ?? 0;
      acc.completed += r.completed ?? 0;
      acc.overdue += r.overdue ?? 0;
      if ((r.overdue ?? 0) > 0) acc.nonCompliant += 1;
      return acc;
    },
    { assigned: 0, completed: 0, overdue: 0, nonCompliant: 0 },
  );

  const overallPct =
    totals.assigned > 0 ? Math.round((totals.completed / totals.assigned) * 100) : 100;

  return (
    <ScreenScroll refreshing={refreshing} onRefresh={onRefresh} edges={[]}>
      <PageHeader title="Training reports" subtitle={`${items.length} people`} />

      {error ? <Banner tone="danger" message={error} /> : null}

      {loading && items.length === 0 ? (
        <SkeletonMetricGrid count={3} />
      ) : (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
            <MetricTile
              label="Not compliant"
              value={totals.nonCompliant}
              tone={totals.nonCompliant > 0 ? 'danger' : 'success'}
              hint="people with overdue training"
            />
            <MetricTile label="Overdue items" value={totals.overdue} tone="warn" />
            <MetricTile label="Completion" value={`${overallPct}%`} />
          </View>

          <Card padded={false}>
            <View style={{ padding: spacing.lg, paddingBottom: spacing.sm }}>
              <SectionHeader title="By person" />
            </View>

            {items.length === 0 ? (
              <View style={{ paddingBottom: spacing.lg }}>
                <EmptyState compact title="No training assigned yet" />
              </View>
            ) : (
              [...items]
                // Worst first — the point of the screen is finding who to chase.
                .sort((a, b) => (b.overdue ?? 0) - (a.overdue ?? 0))
                .map((row, i) => {
                  const pct = Math.round(
                    row.compliance_percent ??
                      ((row.completed ?? 0) / Math.max(1, row.assigned ?? 0)) * 100,
                  );
                  const bad = (row.overdue ?? 0) > 0;
                  return (
                    <View key={row.user_id ?? row.email ?? i}>
                      {i > 0 ? <Divider inset={spacing.lg} /> : null}
                      <View style={{ paddingHorizontal: spacing.lg, paddingVertical: spacing.md }}>
                        <View
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: spacing.sm,
                          }}
                        >
                          <Text
                            numberOfLines={1}
                            style={{ flex: 1, fontSize: fontSize.base, color: colors.ink }}
                          >
                            {row.full_name?.trim() || row.email || 'Unknown'}
                          </Text>
                          {bad ? (
                            <Pill label={`${row.overdue} overdue`} tone="danger" size="sm" />
                          ) : (
                            <Pill label="On track" tone="success" size="sm" />
                          )}
                        </View>
                        <View
                          style={{
                            height: 6,
                            borderRadius: radius.pill,
                            backgroundColor: colors.hover,
                            overflow: 'hidden',
                            marginTop: spacing.sm,
                          }}
                        >
                          <View
                            style={{
                              width: `${Math.max(0, Math.min(100, pct))}%`,
                              height: '100%',
                              backgroundColor: bad ? colors.danger : colors.success,
                            }}
                          />
                        </View>
                        <Text style={{ fontSize: fontSize.xs, color: colors.faint, marginTop: 4 }}>
                          {row.completed ?? 0} of {row.assigned ?? 0} complete
                        </Text>
                      </View>
                    </View>
                  );
                })
            )}
          </Card>
        </>
      )}
    </ScreenScroll>
  );
}
