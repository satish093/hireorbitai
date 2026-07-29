import { useMemo, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Screen, ListScreen, Banner } from '../../src/components/ui/Screen';
import { PageTopBar } from '../../src/components/ui/TopBar';
import { Divider } from '../../src/components/ui/Card';
import { pillToneColor, type PillTone } from '../../src/components/ui/Pill';
import { Tabs } from '../../src/components/ui/Tabs';
import { Sheet } from '../../src/components/ui/Sheet';
import { Button } from '../../src/components/ui/Button';
import { FormInput } from '../../src/components/ui/Inputs';
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
  const [composeOpen, setComposeOpen] = useState(false);

  const { items, loading, refreshing, error, onRefresh, refetch } = useApiList<ReminderRow>(
    '/reminders',
    { channel: 'reminders' },
  );

  const complete = useApiMutation('post', '/reminders', { invalidates: ['reminders'] });
  const create = useApiMutation<{ title: string; due_at: string; description?: string }>(
    'post',
    '/reminders',
    { invalidates: ['reminders'] },
  );

  const onComplete = async (id: string) => {
    setCompletingId(id);
    await complete.mutate(undefined, `/reminders/${id}/complete`);
    setCompletingId(null);
    void refetch();
  };

  const onCreate = async (payload: { title: string; due_at: string; description?: string }) => {
    const created = await create.mutate(payload);
    if (created) {
      setComposeOpen(false);
      void refetch();
    }
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
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: fontSize.xl, fontWeight: '800', color: colors.ink }}>
                  Reminders &amp; follow-ups
                </Text>
                <Text style={{ fontSize: fontSize.sm, color: colors.muted, marginTop: 4 }}>
                  Personal nudges. The scheduler ships emails at due time once configured.
                </Text>
              </View>
              <Button label="New" size="sm" block={false} onPress={() => setComposeOpen(true)} />
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

      <AddReminderSheet
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        onSubmit={onCreate}
        pending={create.pending}
        error={create.error}
      />
    </Screen>
  );
}

/** Default a fresh reminder to the next round hour, at least an hour out. */
function defaultDue(): Date {
  const d = new Date();
  d.setHours(d.getHours() + 1, 0, 0, 0);
  return d;
}

/**
 * Create-a-reminder sheet — the mobile port of the web's "New reminder" /
 * "Add to calendar" flow (POST /reminders with { title, due_at, description }).
 * due_at is sent as a full ISO timestamp, exactly what the create schema wants.
 */
export function AddReminderSheet({
  open,
  onClose,
  onSubmit,
  pending,
  error,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: { title: string; due_at: string; description?: string }) => void;
  pending?: boolean;
  error?: string | null;
}) {
  const { spacing } = useTheme();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [due, setDue] = useState<Date>(defaultDue);
  const [touched, setTouched] = useState(false);

  // Reset the form each time the sheet opens so a new reminder starts clean.
  const [wasOpen, setWasOpen] = useState(false);
  if (open && !wasOpen) {
    setWasOpen(true);
    setTitle('');
    setDescription('');
    setDue(defaultDue());
    setTouched(false);
  } else if (!open && wasOpen) {
    setWasOpen(false);
  }

  const canSave = title.trim().length > 0 && !pending;

  const submit = () => {
    setTouched(true);
    if (!title.trim()) return;
    onSubmit({
      title: title.trim(),
      due_at: due.toISOString(),
      description: description.trim() || undefined,
    });
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="New reminder"
      footer={
        <View style={{ gap: spacing.sm }}>
          <Button
            label={pending ? 'Saving…' : 'Save reminder'}
            onPress={submit}
            loading={pending}
            disabled={!canSave}
          />
          <Button label="Cancel" variant="secondary" onPress={onClose} disabled={pending} />
        </View>
      }
    >
      <View>
        <FormInput
          label="Title"
          required
          placeholder="e.g. Follow up with Riley"
          value={title}
          onChangeText={setTitle}
          error={touched && !title.trim() ? 'A title is required.' : null}
          autoFocus
          returnKeyType="next"
        />
        <DueField value={due} onChange={setDue} />
        <FormInput
          label="Description"
          placeholder="Optional notes"
          value={description}
          onChangeText={setDescription}
          multiline
        />
        {error ? (
          <View style={{ marginBottom: spacing.md }}>
            <Banner tone="danger" message={error} />
          </View>
        ) : null}
      </View>
    </Sheet>
  );
}

/**
 * Due date + time. iOS renders self-managing compact pickers inline; Android
 * pops the native dialog from a tap and closes it on selection. In both modes
 * each picker preserves the untouched half of the timestamp because it is
 * seeded from the same `value`.
 */
function DueField({ value, onChange }: { value: Date; onChange: (d: Date) => void }) {
  const { colors, spacing, fontSize } = useTheme();
  const [show, setShow] = useState<'date' | 'time' | null>(null);

  const handleAndroid = (e: DateTimePickerEvent, selected?: Date) => {
    setShow(null);
    if (e.type !== 'dismissed' && selected) onChange(selected);
  };

  return (
    <View style={{ marginBottom: spacing.lg }}>
      <Text
        style={{
          fontSize: fontSize.sm,
          fontWeight: '600',
          color: colors.ink2,
          marginBottom: spacing.xs,
        }}
      >
        Due at <Text style={{ color: colors.danger }}>*</Text>
      </Text>

      {Platform.OS === 'ios' ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <DateTimePicker value={value} mode="date" onChange={(_e, d) => d && onChange(d)} />
          <DateTimePicker value={value} mode="time" onChange={(_e, d) => d && onChange(d)} />
        </View>
      ) : (
        <>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <View style={{ flex: 1 }}>
              <Button
                label={shortDate(value.toISOString())}
                variant="secondary"
                onPress={() => setShow('date')}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                label={timeOfDay(value.toISOString())}
                variant="secondary"
                onPress={() => setShow('time')}
              />
            </View>
          </View>
          {show ? <DateTimePicker value={value} mode={show} onChange={handleAndroid} /> : null}
        </>
      )}
    </View>
  );
}
