import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ListScreen, PageHeader } from '../../../src/components/ui/Screen';
import { Card } from '../../../src/components/ui/Card';
import { Pill } from '../../../src/components/ui/Pill';
import { RouteGuard } from '../../../src/components/RouteGuard';
import { useApiList } from '../../../src/hooks/useApi';
import { BUSINESS_ROLES, type TrainingAssignment } from '../../../src/types';
import { useTheme } from '../../../src/theme';

/**
 * My training — the learner view of assigned courses.
 *
 * Available to every business role (not just consultants); compliance training
 * is assigned across the org.
 */
export default function MyTrainingScreen() {
  return (
    <RouteGuard allow={[...BUSINESS_ROLES]} feature="training">
      <MyTrainingList />
    </RouteGuard>
  );
}

function MyTrainingList() {
  const router = useRouter();
  const { colors, spacing, fontSize, radius } = useTheme();

  // GET /training/my-training — open to any authenticated user.
  // NOT /training/assignments: that is the MANAGER_TIER admin view of everyone's
  // assignments, and calling it as a consultant returns 403.
  const { items, loading, refreshing, error, onRefresh, refetch } = useApiList<TrainingAssignment>(
    '/training/my-training',
    { channel: 'training' },
  );

  const inProgress = items.filter((a) => (a.progress_percent ?? 0) > 0 && !a.completed_at);
  const ordered = [...inProgress, ...items.filter((a) => !inProgress.includes(a))];

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
        emptyTitle="No courses assigned"
        emptyDescription="Courses your team assigns to you will appear here."
        renderItem={({ item }) => {
          const pct = Math.max(0, Math.min(100, Math.round(item.progress_percent ?? 0)));
          const done = !!item.completed_at || pct >= 100;
          const overdue = !done && !!item.due_at && new Date(item.due_at).getTime() < Date.now();

          return (
            <Card onPress={() => router.push(`/(app)/training/course/${item.course_id}`)}>
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
                  {item.due_at ? (
                    <Text
                      style={{
                        fontSize: fontSize.xs,
                        color: overdue ? colors.danger : colors.faint,
                      }}
                    >
                      Due {new Date(item.due_at).toLocaleDateString()}
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
