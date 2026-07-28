import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Screen, ListScreen } from '../../src/components/ui/Screen';
import { PageTopBar } from '../../src/components/ui/TopBar';
import { MetricTile, Divider } from '../../src/components/ui/Card';
import { INVOICE_STATUS_TONE, pillToneColor } from '../../src/components/ui/Pill';
import { Tabs } from '../../src/components/ui/Tabs';
import { RouteGuard } from '../../src/components/RouteGuard';
import { useApiList } from '../../src/hooks/useApi';
import { useScreenCaptureGuard } from '../../src/security/PrivacyScreen';
import { MANAGER_TIER, type Invoice } from '../../src/types';
import { useTheme } from '../../src/theme';
import { money, shortDate } from '../../src/utils/format';

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

  const { colors, spacing, fontSize } = useTheme();
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('ALL');

  const { items, loading, refreshing, error, onRefresh, refetch } = useApiList<Invoice>(
    '/invoices',
    { channel: 'invoices' },
  );

  const isOverdue = (i: Invoice) =>
    (i.status ?? '').toUpperCase() !== 'PAID' &&
    !!i.due_date &&
    new Date(i.due_date).getTime() < Date.now();

  const filtered = useMemo(
    () =>
      filter === 'ALL'
        ? items
        : filter === 'OVERDUE'
          ? items.filter(isOverdue)
          : items.filter((i) => (i.status ?? '').toUpperCase() === filter),
    [items, filter],
  );

  const counts = useMemo(() => {
    const c: Record<(typeof FILTERS)[number], number> = {
      ALL: items.length,
      DRAFT: 0,
      SENT: 0,
      PAID: 0,
      OVERDUE: 0,
    };
    for (const i of items) {
      const s = (i.status ?? 'DRAFT').toUpperCase();
      if (s === 'DRAFT' || s === 'SENT' || s === 'PAID') c[s] += 1;
      if (isOverdue(i)) c.OVERDUE += 1;
    }
    return c;
  }, [items]);

  const totals = useMemo(() => {
    let invoiced = 0;
    let outstanding = 0;
    let paid = 0;
    let overdue = 0;
    for (const i of items) {
      const total = i.amount_total ?? 0;
      const settled = i.amount_paid ?? 0;
      const bal = Math.max(0, total - settled);
      invoiced += total;
      paid += settled;
      outstanding += bal;
      if (isOverdue(i)) overdue += bal;
    }
    return { invoiced, outstanding, paid, overdue };
  }, [items]);

  return (
    <Screen edges={['top']}>
      <PageTopBar title="Invoices" subtitle={`${items.length} total`} showBack />
      <ListScreen
        items={filtered}
        loading={loading}
        refreshing={refreshing}
        error={error}
        onRefresh={onRefresh}
        onRetry={() => void refetch()}
        keyExtractor={(i) => i.id}
        ItemSeparatorComponent={() => <Divider />}
        contentContainerStyle={{
          paddingHorizontal: spacing.lg,
          paddingTop: spacing.sm,
          paddingBottom: spacing['4xl'] + insets.bottom,
          flexGrow: 1,
        }}
        header={
          <View style={{ gap: spacing.md, marginBottom: spacing.xs }}>
            <View>
              <Text style={{ fontSize: fontSize.xl, fontWeight: '800', color: colors.ink }}>
                Invoices
              </Text>
              <Text style={{ fontSize: fontSize.sm, color: colors.muted, marginTop: 4 }}>
                Create, approve, deliver, and track company invoices.
              </Text>
            </View>
            <View style={{ flexDirection: 'row', gap: spacing.md }}>
              <MetricTile label="Total invoiced" value={money(totals.invoiced)} accent="blue" />
              <MetricTile label="Paid" value={money(totals.paid)} tone="success" accent="green" />
            </View>
            <View style={{ flexDirection: 'row', gap: spacing.md }}>
              <MetricTile
                label="Outstanding"
                value={money(totals.outstanding)}
                tone="warn"
                accent="amber"
              />
              <MetricTile
                label="Overdue"
                value={money(totals.overdue)}
                tone={totals.overdue > 0 ? 'danger' : 'default'}
                accent="red"
                hint={`${counts.OVERDUE} invoice${counts.OVERDUE === 1 ? '' : 's'}`}
              />
            </View>
            <Tabs
              items={FILTERS.map((f) => ({
                key: f,
                label: f === 'ALL' ? 'All' : f.charAt(0) + f.slice(1).toLowerCase(),
                count: counts[f],
              }))}
              value={filter}
              onChange={(k) => setFilter(k as (typeof FILTERS)[number])}
            />
          </View>
        }
        emptyTitle={filter === 'ALL' ? 'No invoices' : `Nothing ${filter.toLowerCase()}`}
        emptyDescription="Invoices raised for client companies appear here."
        renderItem={({ item }) => {
          const status = (item.status ?? 'DRAFT').toUpperCase();
          const outstanding = Math.max(0, (item.amount_total ?? 0) - (item.amount_paid ?? 0));
          const overdue =
            status !== 'PAID' && !!item.due_date && new Date(item.due_date).getTime() < Date.now();
          const shownStatus = overdue ? 'OVERDUE' : status;
          const statusColor = pillToneColor(INVOICE_STATUS_TONE[shownStatus] ?? 'neutral', colors);
          const statusLabel = shownStatus.charAt(0) + shownStatus.slice(1).toLowerCase();

          return (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'flex-start',
                gap: spacing.md,
                paddingVertical: 12,
              }}
            >
              <View style={{ flex: 1, minWidth: 0 }}>
                {item.invoice_number ? (
                  <Text style={{ fontSize: fontSize.xs, color: colors.faint }}>
                    {item.invoice_number}
                  </Text>
                ) : null}
                <Text
                  numberOfLines={1}
                  style={{ fontSize: fontSize.md, fontWeight: '600', color: colors.ink }}
                >
                  {item.name ?? item.invoice_number ?? 'Invoice'}
                </Text>
                {item.bill_to ? (
                  <Text
                    numberOfLines={1}
                    style={{ fontSize: fontSize.sm, color: colors.muted, marginTop: 2 }}
                  >
                    {item.bill_to}
                  </Text>
                ) : null}
                {outstanding > 0 && status !== 'DRAFT' ? (
                  <Text
                    style={{
                      fontSize: fontSize.xs,
                      color: overdue ? colors.danger : colors.muted,
                      marginTop: 4,
                    }}
                  >
                    {money(outstanding, item.currency)} balance
                    {item.due_date ? ` · due ${shortDate(item.due_date)}` : ''}
                  </Text>
                ) : null}
              </View>
              <View style={{ alignItems: 'flex-end', gap: 6 }}>
                <Text style={{ fontSize: fontSize.md, fontWeight: '700', color: colors.ink }}>
                  {money(item.amount_total ?? 0, item.currency)}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <View
                    style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: statusColor }}
                  />
                  <Text style={{ fontSize: fontSize.sm, fontWeight: '600', color: statusColor }}>
                    {statusLabel}
                  </Text>
                </View>
              </View>
            </View>
          );
        }}
      />
    </Screen>
  );
}

// `money` (Intl-free) lives in src/utils/format.ts.
