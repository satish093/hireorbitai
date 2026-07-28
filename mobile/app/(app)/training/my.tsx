import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Screen, ListScreen } from '../../../src/components/ui/Screen';
import { PageTopBar } from '../../../src/components/ui/TopBar';
import { Divider } from '../../../src/components/ui/Card';
import { Tabs } from '../../../src/components/ui/Tabs';
import { RouteGuard } from '../../../src/components/RouteGuard';
import { useApiList } from '../../../src/hooks/useApi';
import { BUSINESS_ROLES } from '../../../src/types';
import { useTheme } from '../../../src/theme';
import { shortDate } from '../../../src/utils/format';

/**
 * My training — the learner view of assigned courses.
 *
 * GET /training/my-training — open to any authenticated user. Returns
 * `training_assignments` rows (progress_percentage / due_date / status) with an
 * embedded `course`. NOT /training/assignments, which is the MANAGER_TIER
 * org-wide view and 403s for a consultant.
 */
export default function MyTrainingScreen() {
  return (
    <RouteGuard allow={[...BUSINESS_ROLES]} feature="training">
      <MyTrainingList />
    </RouteGuard>
  );
}

interface MyAssignment {
  id: string;
  course_id: string;
  status?: string | null;
  progress_percentage?: number | null;
  due_date?: string | null;
  completed_at?: string | null;
  course?: {
    id?: string;
    title?: string | null;
    category?: string | null;
    difficulty?: string | null;
  } | null;
}

type Filter = 'all' | 'in_progress' | 'completed' | 'overdue';

function isDone(a: MyAssignment): boolean {
  return a.status === 'COMPLETED' || !!a.completed_at || (a.progress_percentage ?? 0) >= 100;
}
function isOverdue(a: MyAssignment): boolean {
  if (isDone(a)) return false;
  if (a.status === 'OVERDUE') return true;
  return !!a.due_date && new Date(a.due_date).getTime() < Date.now();
}

function MyTrainingList() {
  const router = useRouter();
  const { colors, spacing, fontSize } = useTheme();
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState<Filter>('all');

  const { items, loading, refreshing, error, onRefresh, refetch } = useApiList<MyAssignment>(
    '/training/my-training',
    { channel: 'training' },
  );

  const counts = useMemo(
    () => ({
      all: items.length,
      in_progress: items.filter((a) => !isDone(a) && (a.progress_percentage ?? 0) > 0).length,
      completed: items.filter(isDone).length,
      overdue: items.filter(isOverdue).length,
    }),
    [items],
  );

  const ordered = useMemo(() => {
    const base =
      filter === 'completed'
        ? items.filter(isDone)
        : filter === 'overdue'
          ? items.filter(isOverdue)
          : filter === 'in_progress'
            ? items.filter((a) => !isDone(a) && (a.progress_percentage ?? 0) > 0)
            : items;
    // In-progress first, then everything else — matches the web grouping.
    const inProg = base.filter((a) => !isDone(a) && (a.progress_percentage ?? 0) > 0);
    return [...inProg, ...base.filter((a) => !inProg.includes(a))];
  }, [items, filter]);

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: false }} />
      <PageTopBar title="My training" subtitle={`${items.length} assigned`} />
      <ListScreen
        items={ordered}
        loading={loading}
        refreshing={refreshing}
        error={error}
        onRefresh={onRefresh}
        onRetry={() => void refetch()}
        keyExtractor={(a) => a.id}
        ItemSeparatorComponent={() => <Divider inset={spacing.lg} />}
        contentContainerStyle={{
          paddingBottom: spacing['4xl'] + insets.bottom,
          flexGrow: 1,
        }}
        header={
          <Tabs
            value={filter}
            onChange={(k) => setFilter(k as Filter)}
            items={[
              { key: 'all', label: 'All', count: counts.all },
              { key: 'in_progress', label: 'In progress', count: counts.in_progress },
              { key: 'completed', label: 'Completed', count: counts.completed },
              { key: 'overdue', label: 'Overdue', count: counts.overdue },
            ]}
          />
        }
        emptyTitle={filter === 'all' ? 'No courses assigned' : 'Nothing here'}
        emptyDescription="Courses your team assigns to you will appear here."
        renderItem={({ item }) => {
          const pct = Math.max(0, Math.min(100, Math.round(item.progress_percentage ?? 0)));
          const done = isDone(item);
          const overdue = isOverdue(item);
          const statusColor = done ? colors.success : overdue ? colors.danger : colors.accent;
          const statusLabel = done ? 'Complete' : overdue ? 'Overdue' : `${pct}%`;
          const meta = [
            item.course?.category,
            item.due_date ? `Due ${shortDate(item.due_date)}` : null,
          ]
            .filter(Boolean)
            .join(' · ');

          return (
            <Pressable
              onPress={() =>
                router.push(`/(app)/training/course/${item.course_id}?assignmentId=${item.id}`)
              }
              style={({ pressed }) => ({
                paddingHorizontal: spacing.lg,
                paddingVertical: spacing.md,
                backgroundColor: pressed ? colors.hover : 'transparent',
                gap: spacing.sm,
              })}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                <Text
                  numberOfLines={2}
                  style={{ flex: 1, fontSize: fontSize.base, fontWeight: '600', color: colors.ink }}
                >
                  {item.course?.title ?? 'Course'}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <View
                    style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: statusColor }}
                  />
                  <Text style={{ fontSize: fontSize.xs, fontWeight: '700', color: statusColor }}>
                    {statusLabel}
                  </Text>
                </View>
              </View>

              {meta ? (
                <Text numberOfLines={1} style={{ fontSize: fontSize.sm, color: colors.muted }}>
                  {meta}
                </Text>
              ) : null}

              <View
                style={{
                  height: 5,
                  borderRadius: 3,
                  backgroundColor: colors.hover,
                  overflow: 'hidden',
                }}
              >
                <View style={{ width: `${pct}%`, height: '100%', backgroundColor: statusColor }} />
              </View>
            </Pressable>
          );
        }}
      />
    </Screen>
  );
}
