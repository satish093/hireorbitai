import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { ScreenScroll, PageHeader, Banner } from '../../src/components/ui/Screen';
import { Card, SectionHeader, Divider } from '../../src/components/ui/Card';
import { Pill, INTERVIEW_STATUS_TONE } from '../../src/components/ui/Pill';
import { SkeletonList, EmptyState } from '../../src/components/ui/States';
import { RouteGuard } from '../../src/components/RouteGuard';
import { useApiList } from '../../src/hooks/useApi';
import { BUSINESS_ROLES, type Interview, type Reminder } from '../../src/types';
import { useTheme } from '../../src/theme';

/**
 * Calendar — agenda view.
 *
 * The web offers month / week / day grids. A month grid on a phone gives each
 * day about 45×45pt, which can hold a dot and nothing else — so mobile uses an
 * AGENDA: days as sections, events as rows, grouped and ordered. Same events,
 * a layout that can actually be read.
 *
 * Sources are combined client-side because the calendar is a VIEW over two
 * modules (interviews and reminders) rather than its own store — the same thing
 * the web's useCalendarData does.
 */
export default function CalendarScreen() {
  return (
    <RouteGuard allow={[...BUSINESS_ROLES]}>
      <CalendarAgenda />
    </RouteGuard>
  );
}

type AgendaEvent = {
  id: string;
  at: Date;
  title: string;
  subtitle?: string | null;
  kind: 'interview' | 'reminder';
  status?: string | null;
};

const RANGES = [
  { key: 7, label: 'Next 7 days' },
  { key: 30, label: 'Next 30 days' },
  { key: 90, label: 'Next 3 months' },
] as const;

function CalendarAgenda() {
  const { colors, spacing, fontSize, radius } = useTheme();
  const [days, setDays] = useState<(typeof RANGES)[number]['key']>(7);

  const interviews = useApiList<Interview>('/interviews', { channel: 'interviews' });
  const reminders = useApiList<Reminder>('/reminders', { channel: 'reminders' });

  const loading = interviews.loading || reminders.loading;
  const refreshing = interviews.refreshing || reminders.refreshing;
  const onRefresh = () => {
    void interviews.refetch();
    void reminders.refetch();
  };

  const sections = useMemo(() => {
    const now = new Date();
    const horizon = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

    const events: AgendaEvent[] = [];

    for (const iv of interviews.items) {
      if (!iv.scheduled_at) continue;
      const at = new Date(iv.scheduled_at);
      if (at < startOfDay(now) || at > horizon) continue;
      events.push({
        id: `iv-${iv.id}`,
        at,
        title: `${title(iv.interview_type)} interview`,
        subtitle: iv.location,
        kind: 'interview',
        status: iv.status,
      });
    }

    for (const r of reminders.items) {
      const at = new Date(r.remind_at);
      if (Number.isNaN(at.getTime())) continue;
      if (at < startOfDay(now) || at > horizon) continue;
      events.push({
        id: `rm-${r.id}`,
        at,
        title: r.title,
        subtitle: r.body,
        kind: 'reminder',
        status: r.status,
      });
    }

    events.sort((a, b) => a.at.getTime() - b.at.getTime());

    // Group into day buckets, preserving order.
    const byDay = new Map<string, AgendaEvent[]>();
    for (const e of events) {
      const key = e.at.toDateString();
      byDay.set(key, [...(byDay.get(key) ?? []), e]);
    }
    return [...byDay.entries()];
  }, [interviews.items, reminders.items, days]);

  return (
    <ScreenScroll refreshing={refreshing} onRefresh={onRefresh}>
      <PageHeader title="Calendar" />

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: spacing.sm, paddingVertical: 2 }}
      >
        {RANGES.map((r) => {
          const active = r.key === days;
          return (
            <Pressable
              key={r.key}
              onPress={() => setDays(r.key)}
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
                {r.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {interviews.error ? <Banner tone="danger" message={interviews.error} /> : null}

      {loading && sections.length === 0 ? (
        <SkeletonList count={3} />
      ) : sections.length === 0 ? (
        <Card>
          <EmptyState
            compact
            title="Nothing scheduled"
            description="Interviews and reminders in this window will appear here."
          />
        </Card>
      ) : (
        sections.map(([dayKey, events]) => (
          <Card key={dayKey} padded={false}>
            <View style={{ padding: spacing.lg, paddingBottom: spacing.sm }}>
              <SectionHeader title={dayLabel(new Date(dayKey))} />
            </View>
            {events.map((e, i) => (
              <View key={e.id}>
                {i > 0 ? <Divider inset={spacing.lg} /> : null}
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'flex-start',
                    gap: spacing.md,
                    paddingHorizontal: spacing.lg,
                    paddingVertical: spacing.md,
                  }}
                >
                  <Text
                    style={{
                      fontSize: fontSize.sm,
                      color: colors.muted,
                      width: 62,
                      fontVariant: ['tabular-nums'],
                    }}
                  >
                    {e.at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                  </Text>
                  <View style={{ flex: 1 }}>
                    <Text
                      numberOfLines={2}
                      style={{ fontSize: fontSize.base, color: colors.ink, fontWeight: '600' }}
                    >
                      {e.title}
                    </Text>
                    {e.subtitle ? (
                      <Text
                        numberOfLines={1}
                        style={{ fontSize: fontSize.sm, color: colors.muted, marginTop: 2 }}
                      >
                        {e.subtitle}
                      </Text>
                    ) : null}
                  </View>
                  <Pill
                    label={e.kind === 'interview' ? 'Interview' : 'Reminder'}
                    tone={
                      e.kind === 'interview'
                        ? (INTERVIEW_STATUS_TONE[e.status ?? ''] ?? 'info')
                        : 'accent'
                    }
                    size="sm"
                  />
                </View>
              </View>
            ))}
          </Card>
        ))
      )}
    </ScreenScroll>
  );
}

function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

function dayLabel(d: Date): string {
  const today = startOfDay(new Date());
  const target = startOfDay(d);
  const diffDays = Math.round((target.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Tomorrow';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

function title(s: string): string {
  return s.charAt(0) + s.slice(1).toLowerCase();
}
