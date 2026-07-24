import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { ListScreen, PageHeader, Banner } from '../../src/components/ui/Screen';
import { Card } from '../../src/components/ui/Card';
import { Pill } from '../../src/components/ui/Pill';
import { Button } from '../../src/components/ui/Button';
import { RouteGuard } from '../../src/components/RouteGuard';
import { useApiList, useApiMutation } from '../../src/hooks/useApi';
import { BUSINESS_ROLES, type Reminder } from '../../src/types';
import { useTheme } from '../../src/theme';

/**
 * Reminders — GET /reminders, POST /reminders/:id/complete.
 *
 * Completion uses the dedicated /complete endpoint, not a general PATCH with a
 * status field, so the client never sends a status column into a row update.
 *
 * Dispatch is a backend concern: reminders.job retries with exponential backoff
 * (1m → 16m, 5 attempts) before force-marking SENT. The app only reads state and
 * completes; it never tries to drive delivery.
 */
export default function RemindersScreen() {
  return (
    <RouteGuard allow={[...BUSINESS_ROLES]} feature="reminders">
      <RemindersList />
    </RouteGuard>
  );
}

function RemindersList() {
  const { colors, spacing, fontSize } = useTheme();
  const [completingId, setCompletingId] = useState<string | null>(null);

  const { items, loading, refreshing, error, onRefresh, refetch } = useApiList<Reminder>(
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

  // Soonest first — a reminder list is only useful in time order.
  const sorted = useMemo(
    () =>
      [...items].sort((a, b) => new Date(a.remind_at).getTime() - new Date(b.remind_at).getTime()),
    [items],
  );

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
        header={complete.error ? <Banner tone="danger" message={complete.error} /> : undefined}
        emptyTitle="No reminders"
        emptyDescription="Reminders you or your team set will appear here."
        renderItem={({ item }) => {
          const when = new Date(item.remind_at);
          const overdue = when.getTime() < Date.now() && item.status !== 'COMPLETED';
          const done = item.status === 'COMPLETED';
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
                  {item.body ? (
                    <Text
                      numberOfLines={3}
                      style={{ fontSize: fontSize.sm, color: colors.muted, marginTop: 2 }}
                    >
                      {item.body}
                    </Text>
                  ) : null}
                  <Text
                    style={{
                      fontSize: fontSize.xs,
                      color: overdue ? colors.danger : colors.faint,
                      marginTop: 6,
                    }}
                  >
                    {when.toLocaleString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </Text>
                </View>
                {done ? (
                  <Pill label="Done" tone="success" size="sm" />
                ) : overdue ? (
                  <Pill label="Overdue" tone="danger" size="sm" />
                ) : item.status ? (
                  <Pill label={item.status} tone="info" size="sm" />
                ) : null}
              </View>

              {!done ? (
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
