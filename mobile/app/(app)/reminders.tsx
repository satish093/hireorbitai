import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { ListScreen, PageHeader, Banner } from '../../src/components/ui/Screen';
import { Card } from '../../src/components/ui/Card';
import { Pill, type PillTone } from '../../src/components/ui/Pill';
import { Tabs } from '../../src/components/ui/Tabs';
import { Button } from '../../src/components/ui/Button';
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
    <>
      <PageHeader title="Reminders" subtitle={`${items.length} total`} />
      <ListScreen
        items={sorted}
        loading={loading}
        refreshing={refreshing}
        error={error}
        onRefresh={onRefresh}
        onRetry={() => void refetch()}
        keyExtractor={(r) => r.id}
        header={
          <View style={{ gap: spacing.md }}>
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
        emptyDescription="Reminders you or your team set will appear here."
        renderItem={({ item }) => {
          const status = (item.status ?? 'PENDING').toUpperCase();
          const when = new Date(item.due_at);
          const done = status === 'DONE';
          const overdue = !done && status !== 'SENT' && when.getTime() < Date.now();
          const actionable = status !== 'DONE' && status !== 'SENT';
          return (
            <Card>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md }}>
                <View style={{ flex: 1 }}>
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
                      numberOfLines={3}
                      style={{ fontSize: fontSize.sm, color: colors.muted, marginTop: 2 }}
                    >
                      {item.description}
                    </Text>
                  ) : null}
                  <Text
                    style={{
                      fontSize: fontSize.xs,
                      color: overdue ? colors.danger : colors.faint,
                      marginTop: 6,
                    }}
                  >
                    {shortDate(item.due_at)} · {timeOfDay(item.due_at)}
                  </Text>
                </View>
                {overdue ? (
                  <Pill label="Overdue" tone="danger" size="sm" />
                ) : (
                  <Pill
                    label={status.charAt(0) + status.slice(1).toLowerCase()}
                    tone={STATUS_TONE[status] ?? 'neutral'}
                    size="sm"
                  />
                )}
              </View>

              {actionable ? (
                <View style={{ marginTop: spacing.md }}>
                  <Button
                    label="Mark done"
                    variant="secondary"
                    size="sm"
                    onPress={() => void onComplete(item.id)}
                    loading={completingId === item.id}
                    disabled={complete.pending}
                  />
                </View>
              ) : null}
            </Card>
          );
        }}
      />
    </>
  );
}
