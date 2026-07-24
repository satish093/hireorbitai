import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { ListScreen, PageHeader } from '../../src/components/ui/Screen';
import { Card } from '../../src/components/ui/Card';
import { Pill, INTERVIEW_STATUS_TONE } from '../../src/components/ui/Pill';
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
  const { colors, spacing, fontSize, radius } = useTheme();
  const [filter, setFilter] = useState<'UPCOMING' | 'ALL' | InterviewStatus>('UPCOMING');

  const { items, loading, refreshing, error, onRefresh, refetch } = useApiList<Interview>(
    '/interviews',
    { channel: 'interviews' },
  );

  const filtered = useMemo(() => {
    const now = Date.now();
    let list = items;
    if (filter === 'UPCOMING') {
      list = items.filter(
        (i) =>
          i.status === 'SCHEDULED' && i.scheduled_at && new Date(i.scheduled_at).getTime() >= now,
      );
    } else if (filter !== 'ALL') {
      list = items.filter((i) => i.status === filter);
    }
    return [...list].sort((a, b) => {
      const at = a.scheduled_at ? new Date(a.scheduled_at).getTime() : Infinity;
      const bt = b.scheduled_at ? new Date(b.scheduled_at).getTime() : Infinity;
      return at - bt;
    });
  }, [items, filter]);

  return (
    <>
      <PageHeader title="Interviews" subtitle={`${items.length} total`} />
      <ListScreen
        items={filtered}
        loading={loading}
        refreshing={refreshing}
        error={error}
        onRefresh={onRefresh}
        onRetry={() => void refetch()}
        keyExtractor={(i) => i.id}
        header={
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
                    {f === 'ALL'
                      ? 'All'
                      : f === 'UPCOMING'
                        ? 'Upcoming'
                        : f.charAt(0) + f.slice(1).toLowerCase().replace('_', ' ')}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        }
        emptyTitle={filter === 'UPCOMING' ? 'Nothing scheduled' : 'No interviews'}
        emptyDescription="Interviews booked for your consultants appear here."
        renderItem={({ item }) => {
          const when = item.scheduled_at ? new Date(item.scheduled_at) : null;
          const soon =
            when &&
            when.getTime() - Date.now() < 24 * 60 * 60 * 1000 &&
            when.getTime() > Date.now();
          return (
            <Card>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: fontSize.md, fontWeight: '600', color: colors.ink }}>
                    {item.interview_type.charAt(0) + item.interview_type.slice(1).toLowerCase()}{' '}
                    interview
                  </Text>
                  <Text style={{ fontSize: fontSize.sm, color: colors.ink2, marginTop: 2 }}>
                    {when
                      ? when.toLocaleString(undefined, {
                          weekday: 'short',
                          month: 'short',
                          day: 'numeric',
                          hour: 'numeric',
                          minute: '2-digit',
                        })
                      : 'Time to be confirmed'}
                  </Text>
                  {item.location ? (
                    <Text
                      numberOfLines={1}
                      style={{ fontSize: fontSize.sm, color: colors.muted, marginTop: 2 }}
                    >
                      {item.location}
                    </Text>
                  ) : null}
                </View>
                <View style={{ alignItems: 'flex-end', gap: 6 }}>
                  <Pill
                    label={item.status.replace('_', ' ')}
                    tone={INTERVIEW_STATUS_TONE[item.status] ?? 'neutral'}
                    size="sm"
                  />
                  {soon ? <Pill label="Soon" tone="warn" size="sm" /> : null}
                </View>
              </View>

              {item.duration_minutes ? (
                <Text style={{ fontSize: fontSize.xs, color: colors.faint, marginTop: spacing.sm }}>
                  {item.duration_minutes} minutes
                </Text>
              ) : null}
            </Card>
          );
        }}
      />
    </>
  );
}
