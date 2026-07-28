import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ListScreen, PageHeader } from '../../../src/components/ui/Screen';
import { Card } from '../../../src/components/ui/Card';
import { Pill } from '../../../src/components/ui/Pill';
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
  const { colors, spacing, fontSize, radius } = useTheme();
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
    <>
      <PageHeader title="My training" subtitle={`${items.length} assigned`} />
      <ListScreen
        items={ordered}
        loading={loading}
        refreshing={refreshing}
        error={error}
        onRefresh={onRefresh}
        onRetry={() => void refetch()}
        keyExtractor={(a) => a.id}
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

          return (
            <Card
              onPress={() =>
                router.push(`/(app)/training/course/${item.course_id}?assignmentId=${item.id}`)
              }
            >
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md }}>
                <View style={{ flex: 1 }}>
                  <Text
                    numberOfLines={2}
                    style={{ fontSize: fontSize.md, fontWeight: '600', color: colors.ink }}
                  >
                    {item.course?.title ?? 'Course'}
                  </Text>
                  {item.course?.category ? (
                    <Text style={{ fontSize: fontSize.sm, color: colors.muted, marginTop: 2 }}>
                      {item.course.category}
                    </Text>
                  ) : null}
                </View>
                {done ? (
                  <Pill label="Complete" tone="success" size="sm" />
                ) : overdue ? (
                  <Pill label="Overdue" tone="danger" size="sm" />
                ) : null}
              </View>

              {/* Progress bar. A number alone doesn't read at a glance. */}
              <View style={{ marginTop: spacing.md }}>
                <View
                  style={{
                    height: 6,
                    borderRadius: radius.pill,
                    backgroundColor: colors.hover,
                    overflow: 'hidden',
                  }}
                >
                  <View
                    style={{
                      width: `${pct}%`,
                      height: '100%',
                      backgroundColor: done ? colors.success : colors.accent,
                    }}
                  />
                </View>
                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    marginTop: 6,
                  }}
                >
                  <Text style={{ fontSize: fontSize.xs, color: colors.muted }}>
                    {pct}% complete
                  </Text>
                  {item.due_date ? (
                    <Text
                      style={{
                        fontSize: fontSize.xs,
                        color: overdue ? colors.danger : colors.faint,
                      }}
                    >
                      Due {shortDate(item.due_date)}
                    </Text>
                  ) : null}
                </View>
              </View>
            </Card>
          );
        }}
      />
    </>
  );
}
