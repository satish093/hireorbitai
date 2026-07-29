import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Screen, ListScreen } from '../../src/components/ui/Screen';
import { PageTopBar } from '../../src/components/ui/TopBar';
import { Divider } from '../../src/components/ui/Card';
import { INTERVIEW_STATUS_TONE, pillToneColor } from '../../src/components/ui/Pill';
import { Tabs } from '../../src/components/ui/Tabs';
import { RouteGuard } from '../../src/components/RouteGuard';
import { useApiList } from '../../src/hooks/useApi';
import { BUSINESS_ROLES, type Interview, type InterviewStatus } from '../../src/types';
import { useTheme } from '../../src/theme';

/**
 * Interviews — GET /interviews.
 *
 * Behind both the `interviews` feature flag and BUSINESS_ROLES (which excludes
 * a capability-less DEVELOPER).
 *
 * Sorted soonest-first with upcoming above past, because on a phone the only
 * question anyone opens this screen to answer is "what's next".
 */
export default function InterviewsScreen() {
  return (
    <RouteGuard allow={[...BUSINESS_ROLES]} feature="interviews">
      <InterviewsList />
    </RouteGuard>
  );
}

const FILTERS: ('UPCOMING' | 'ALL' | InterviewStatus)[] = [
  'UPCOMING',
  'ALL',
  'SCHEDULED',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
];

function InterviewsList() {
  const { colors, spacing, fontSize } = useTheme();
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState<'UPCOMING' | 'ALL' | InterviewStatus>('UPCOMING');

  const { items, loading, refreshing, error, onRefresh, refetch } = useApiList<Interview>(
    '/interviews',
    { channel: 'interviews' },
  );

  const isUpcoming = (i: Interview) =>
    i.status === 'SCHEDULED' &&
    !!i.scheduled_at &&
    new Date(i.scheduled_at).getTime() >= Date.now();

  const filtered = useMemo(() => {
    let list = items;
    if (filter === 'UPCOMING') {
      list = items.filter(isUpcoming);
    } else if (filter !== 'ALL') {
      list = items.filter((i) => i.status === filter);
    }
    return [...list].sort((a, b) => {
      const at = a.scheduled_at ? new Date(a.scheduled_at).getTime() : Infinity;
      const bt = b.scheduled_at ? new Date(b.scheduled_at).getTime() : Infinity;
      return at - bt;
    });
  }, [items, filter]);

  const counts = useMemo(() => {
    const c = {
      UPCOMING: 0,
      ALL: items.length,
      SCHEDULED: 0,
      COMPLETED: 0,
      CANCELLED: 0,
      NO_SHOW: 0,
    };
    for (const i of items) {
      if (i.status === 'SCHEDULED') c.SCHEDULED += 1;
      else if (i.status === 'COMPLETED') c.COMPLETED += 1;
      else if (i.status === 'CANCELLED') c.CANCELLED += 1;
      else if (i.status === 'NO_SHOW') c.NO_SHOW += 1;
      if (isUpcoming(i)) c.UPCOMING += 1;
    }
    return c;
  }, [items]);

  const tabLabel = (f: (typeof FILTERS)[number]) =>
    f === 'ALL'
      ? 'All'
      : f === 'UPCOMING'
        ? 'Upcoming'
        : f.charAt(0) + f.slice(1).toLowerCase().replace('_', ' ');

  return (
    <Screen edges={['top']}>
      <PageTopBar title="Interviews" subtitle={`${items.length} total`} showBack />
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
          <View style={{ marginBottom: spacing.xs }}>
            <Tabs
              items={FILTERS.map((f) => ({ key: f, label: tabLabel(f), count: counts[f] }))}
              value={filter}
              onChange={(k) => setFilter(k as 'UPCOMING' | 'ALL' | InterviewStatus)}
            />
          </View>
        }
        emptyTitle={filter === 'UPCOMING' ? 'Nothing scheduled' : 'No interviews'}
        emptyDescription="Interviews booked for your consultants appear here."
        renderItem={({ item }) => {
          const when = item.scheduled_at ? new Date(item.scheduled_at) : null;
          const soon =
            when &&
            when.getTime() - Date.now() < 24 * 60 * 60 * 1000 &&
            when.getTime() > Date.now();
          const meta = [
            when
              ? when.toLocaleString(undefined, {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                })
              : 'Time to be confirmed',
            item.location || null,
            item.duration_minutes ? `${item.duration_minutes} min` : null,
          ]
            .filter(Boolean)
            .join(' · ');
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
                  numberOfLines={1}
                  style={{ fontSize: fontSize.md, fontWeight: '600', color: colors.ink }}
                >
                  {item.interview_type.charAt(0) + item.interview_type.slice(1).toLowerCase()}{' '}
                  interview
                </Text>
                <Text numberOfLines={2} style={{ fontSize: fontSize.sm, color: colors.muted }}>
                  {meta}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                <StatusText
                  label={item.status.replace('_', ' ')}
                  color={pillToneColor(INTERVIEW_STATUS_TONE[item.status] ?? 'neutral', colors)}
                />
                {soon ? (
                  <Text style={{ fontSize: fontSize.xs, fontWeight: '600', color: colors.warn }}>
                    Soon
                  </Text>
                ) : null}
              </View>
            </View>
          );
        }}
      />
    </Screen>
  );
}

/** Inline status = a small colored dot + colored text (the website's row status). */
function StatusText({ label, color }: { label: string; color: string }) {
  const { fontSize } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: color }} />
      <Text style={{ fontSize: fontSize.sm, fontWeight: '600', color }}>{label}</Text>
    </View>
  );
}
