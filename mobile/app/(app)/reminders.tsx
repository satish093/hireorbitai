import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Screen, ListScreen, Banner } from '../../src/components/ui/Screen';
import { PageTopBar } from '../../src/components/ui/TopBar';
import { Divider } from '../../src/components/ui/Card';
import { pillToneColor, type PillTone } from '../../src/components/ui/Pill';
import { Tabs } from '../../src/components/ui/Tabs';
import { RouteGuard } from '../../src/components/RouteGuard';
import { useApiList, useApiMutation } from '../../src/hooks/useApi';
import { BUSINESS_ROLES } from '../../src/types';
import { useTheme } from '../../src/theme';
import { shortDate, timeOfDay } from '../../src/utils/format';

/**
 * Reminders — GET /reminders, POST /reminders/:id/complete.
 *
 * Completion uses the dedicated /complete endpoint, not a general PATCH with a
 * status field, so the client never sends a status column into a row update.
 * The endpoint stamps status='DONE' + completed_at server-side.
 *
 * Dispatch is a backend concern: reminders.job retries with exponential backoff
 * (1m → 16m, 5 attempts) before force-marking SENT. The app only reads state and
 * completes; it never tries to drive delivery.
 *
 * Field shape mirrors the API/DB exactly (public.reminders): `due_at`,
 * `description`, and reminder_status ∈ {PENDING, SENT, DONE, SNOOZED}.
 */
export default function RemindersScreen() {
  return (
    <RouteGuard allow={[...BUSINESS_ROLES]} feature="reminders">
      <RemindersList />
    </RouteGuard>
  );
}

/** Reflects the real /reminders payload (the shared Reminder type predates the API). */
interface ReminderRow {
  id: string;
  title: string;
  description?: string | null;
  due_at: string;
  status?: string | null;
  completed_at?: string | null;
}

const STATUS_TONE: Record<string, PillTone> = {
  PENDING: 'info',
  SENT: 'accent',
  DONE: 'success',
  SNOOZED: 'warn',
};

const FILTERS = ['ALL', 'PENDING', 'SENT', 'DONE', 'SNOOZED'] as const;
type Filter = (typeof FILTERS)[number];

function RemindersList() {
  const { colors, spacing, fontSize } = useTheme();
  const insets = useSafeAreaInsets();
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('ALL');

  const { items, loading, refreshing, error, onRefresh, refetch } = useApiList<ReminderRow>(
    '/reminders',
    { channel: 'reminders' },
  );

  const complete = useApiMutation('post', '/reminders', { invalidates: ['reminders'] });

  const onComplete = async (id: string) => {
    setCompletingId(id);
    await complete.mutate(undefined, `/reminders/${id}/complete`);
    setCompletingId(null);
    void refetch();
  };

  const counts = useMemo(() => {
    const c: Record<Filter, number> = {
      ALL: items.length,
      PENDING: 0,
      SENT: 0,
      DONE: 0,
      SNOOZED: 0,
    };
    for (const r of items) {
      const s = (r.status ?? 'PENDING').toUpperCase();
      if (s in c && s !== 'ALL') c[s as Filter] += 1;
    }
    return c;
  }, [items]);

  // Soonest first — a reminder list is only useful in time order.
  const sorted = useMemo(() => {
    const base =
      filter === 'ALL'
        ? items
        : items.filter((r) => (r.status ?? 'PENDING').toUpperCase() === filter);
    return [...base].sort((a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime());
  }, [items, filter]);

  return (
    <Screen edges={['top']}>
      <PageTopBar title="Reminders" showBack />
      <ListScreen
        items={sorted}
        loading={loading}
        refreshing={refreshing}
        error={error}
        onRefresh={onRefresh}
        onRetry={() => void refetch()}
        keyExtractor={(r) => r.id}
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
                Reminders &amp; follow-ups
              </Text>
              <Text style={{ fontSize: fontSize.sm, color: colors.muted, marginTop: 4 }}>
                Personal nudges. The scheduler ships emails at due time once configured.
              </Text>
            </View>
            {complete.error ? <Banner tone="danger" message={complete.error} /> : null}
            <Tabs
              items={FILTERS.map((f) => ({
                key: f,
                label: f === 'ALL' ? 'All' : f.charAt(0) + f.slice(1).toLowerCase(),
                count: counts[f],
              }))}
              value={filter}
              onChange={(k) => setFilter(k as Filter)}
            />
          </View>
        }
        emptyTitle={filter === 'ALL' ? 'No reminders' : `Nothing ${filter.toLowerCase()}`}
        emptyDescription="Add a reminder to track an upcoming follow-up."
        renderItem={({ item }) => {
          const status = (item.status ?? 'PENDING').toUpperCase();
          const when = new Date(item.due_at);
          const done = status === 'DONE';
          const overdue = !done && status !== 'SENT' && when.getTime() < Date.now();
          const actionable = status !== 'DONE' && status !== 'SENT';
          const statusLabel = overdue
            ? 'Overdue'
            : status.charAt(0) + status.slice(1).toLowerCase();
          const statusColor = overdue
            ? colors.danger
            : pillToneColor(STATUS_TONE[status] ?? 'neutral', colors);
          const busy = completingId === item.id;
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
                <Text
                  style={{
                    fontSize: fontSize.md,
                    fontWeight: '600',
                    color: colors.ink,
                    textDecorationLine: done ? 'line-through' : 'none',
                  }}
                >
                  {item.title}
                </Text>
                {item.description ? (
                  <Text
                    numberOfLines={2}
                    style={{ fontSize: fontSize.sm, color: colors.muted, marginTop: 2 }}
                  >
                    {item.description}
                  </Text>
                ) : null}
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 6,
                    marginTop: 6,
                    flexWrap: 'wrap',
                  }}
                >
                  <View
                    style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: statusColor }}
                  />
                  <Text style={{ fontSize: fontSize.sm, fontWeight: '600', color: statusColor }}>
                    {statusLabel}
                  </Text>
                  <Text style={{ fontSize: fontSize.xs, color: colors.faint }}>
                    · {shortDate(item.due_at)} · {timeOfDay(item.due_at)}
                  </Text>
                </View>
              </View>

              {actionable ? (
                <Pressable
                  onPress={() => void onComplete(item.id)}
                  disabled={complete.pending}
                  accessibilityRole="button"
                  accessibilityLabel="Mark reminder done"
                  hitSlop={8}
                  style={({ pressed }) => ({
                    paddingHorizontal: spacing.md,
                    height: 32,
                    borderRadius: 999,
                    borderWidth: 1,
                    borderColor: colors.border,
                    backgroundColor: pressed ? colors.hover : colors.surface,
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: busy ? 0.6 : 1,
                  })}
                >
                  <Text style={{ fontSize: fontSize.sm, fontWeight: '600', color: colors.ink }}>
                    {busy ? '…' : 'Mark done'}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          );
        }}
      />
    </Screen>
  );
}
