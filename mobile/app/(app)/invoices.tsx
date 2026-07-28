import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { ListScreen, PageHeader } from '../../src/components/ui/Screen';
import { Card, MetricTile } from '../../src/components/ui/Card';
import { Pill, INVOICE_STATUS_TONE } from '../../src/components/ui/Pill';
import { RouteGuard } from '../../src/components/RouteGuard';
import { useApiList } from '../../src/hooks/useApi';
import { useScreenCaptureGuard } from '../../src/security/PrivacyScreen';
import { MANAGER_TIER, type Invoice } from '../../src/types';
import { useTheme } from '../../src/theme';
import { money } from '../../src/utils/format';

/**
 * Invoices — GET /invoices.
 *
 * MANAGER_TIER, and the router comment is explicit that this is "strictly
 * MANAGER_TIER, never capability-widened" — so unlike most admin surfaces there
 * is deliberately NO capability escape hatch here, and none is offered.
 *
 * Screen capture is guarded: this screen shows company billing totals.
 */
export default function InvoicesScreen() {
  return (
    <RouteGuard allow={[...MANAGER_TIER]} feature="invoices">
      <InvoicesList />
    </RouteGuard>
  );
}

const FILTERS = ['ALL', 'DRAFT', 'SENT', 'PAID', 'OVERDUE'] as const;

function InvoicesList() {
  useScreenCaptureGuard();

  const { colors, spacing, fontSize, radius } = useTheme();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('ALL');

  const { items, loading, refreshing, error, onRefresh, refetch } = useApiList<Invoice>(
    '/invoices',
    { channel: 'invoices' },
  );

  const filtered = useMemo(
    () =>
      filter === 'ALL' ? items : items.filter((i) => (i.status ?? '').toUpperCase() === filter),
    [items, filter],
  );

  const totals = useMemo(() => {
    let outstanding = 0;
    let paid = 0;
    for (const i of items) {
      const total = i.amount_total ?? 0;
      const settled = i.amount_paid ?? 0;
      paid += settled;
      outstanding += Math.max(0, total - settled);
    }
    return { outstanding, paid };
  }, [items]);

  return (
    <>
      <PageHeader title="Invoices" subtitle={`${items.length} total`} />
      <ListScreen
        items={filtered}
        loading={loading}
        refreshing={refreshing}
        error={error}
        onRefresh={onRefresh}
        onRetry={() => void refetch()}
        keyExtractor={(i) => i.id}
        header={
          <View style={{ gap: spacing.md }}>
            <View style={{ flexDirection: 'row', gap: spacing.md }}>
              <MetricTile label="Outstanding" value={money(totals.outstanding)} tone="warn" />
              <MetricTile label="Collected" value={money(totals.paid)} tone="success" />
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: spacing.sm, paddingVertical: 2 }}
            >
              {FILTERS.map((f) => {
                const active = f === filter;
                return (
                  <Pressable
                    key={f}
                    onPress={() => setFilter(f)}
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
                      {f === 'ALL' ? 'All' : f.charAt(0) + f.slice(1).toLowerCase()}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        }
        emptyTitle={filter === 'ALL' ? 'No invoices' : `Nothing ${filter.toLowerCase()}`}
        emptyDescription="Invoices raised for client companies appear here."
        renderItem={({ item }) => {
          const status = (item.status ?? 'DRAFT').toUpperCase();
          const outstanding = Math.max(0, (item.amount_total ?? 0) - (item.amount_paid ?? 0));
          const overdue =
            status !== 'PAID' && !!item.due_date && new Date(item.due_date).getTime() < Date.now();

          return (
            <Card>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md }}>
                <View style={{ flex: 1 }}>
                  <Text
                    numberOfLines={1}
                    style={{ fontSize: fontSize.md, fontWeight: '600', color: colors.ink }}
                  >
                    {item.name ?? item.invoice_number ?? 'Invoice'}
                  </Text>
                  {item.bill_to ? (
                    <Text
                      numberOfLines={1}
                      style={{ fontSize: fontSize.sm, color: colors.ink2, marginTop: 2 }}
                    >
                      {item.bill_to}
                    </Text>
                  ) : null}
                  {item.invoice_number && item.name ? (
                    <Text style={{ fontSize: fontSize.xs, color: colors.faint, marginTop: 2 }}>
                      {item.invoice_number}
                    </Text>
                  ) : null}
                </View>
                <View style={{ alignItems: 'flex-end', gap: 6 }}>
                  <Text style={{ fontSize: fontSize.md, fontWeight: '700', color: colors.ink }}>
                    {money(item.amount_total ?? 0, item.currency)}
                  </Text>
                  <Pill
                    label={overdue ? 'OVERDUE' : status}
                    tone={INVOICE_STATUS_TONE[overdue ? 'OVERDUE' : status] ?? 'neutral'}
                    size="sm"
                  />
                </View>
              </View>

              {outstanding > 0 && status !== 'DRAFT' ? (
                <Text
                  style={{
                    fontSize: fontSize.xs,
                    color: overdue ? colors.danger : colors.muted,
                    marginTop: spacing.sm,
                  }}
                >
                  {money(outstanding, item.currency)} outstanding
                  {item.due_date ? ` · due ${new Date(item.due_date).toLocaleDateString()}` : ''}
                </Text>
              ) : null}
            </Card>
          );
        }}
      />
    </>
  );
}

// `money` (Intl-free) lives in src/utils/format.ts.
