import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Screen, ListScreen } from '../../../src/components/ui/Screen';
import { PageTopBar } from '../../../src/components/ui/TopBar';
import { Divider } from '../../../src/components/ui/Card';
import { Tabs } from '../../../src/components/ui/Tabs';
import { Avatar } from '../../../src/components/ui/Avatar';
import { RouteGuard } from '../../../src/components/RouteGuard';
import { useApiList } from '../../../src/hooks/useApi';
import { MANAGER_TIER, type UserRef } from '../../../src/types';
import { useTheme } from '../../../src/theme';
import { shortDate } from '../../../src/utils/format';

/**
 * Assignment tracking — GET /training/assignments. MANAGER_TIER.
 *
 * The org-wide view of who has been assigned what. Rows are
 * `training_assignments` (progress_percentage / due_date / status) with an
 * embedded `assignee` (the target user) and `course`. Compliance training has
 * due dates that matter, so overdue is surfaced first and coloured.
 */
export default function TrainingAssignmentsScreen() {
  return (
    <RouteGuard allow={[...MANAGER_TIER]} feature="training">
      <AssignmentsList />
    </RouteGuard>
  );
}

interface AssignmentRow {
  id: string;
  course_id: string;
  status?: string | null;
  progress_percentage?: number | null;
  due_date?: string | null;
  completed_at?: string | null;
  course?: { id?: string; title?: string | null } | null;
  assignee?: UserRef | null;
}

type Filter = 'all' | 'in_progress' | 'overdue' | 'completed';

function isDone(a: AssignmentRow): boolean {
  return a.status === 'COMPLETED' || !!a.completed_at || (a.progress_percentage ?? 0) >= 100;
}
function isOverdue(a: AssignmentRow): boolean {
  if (isDone(a)) return false;
  if (a.status === 'OVERDUE') return true;
  return !!a.due_date && new Date(a.due_date).getTime() < Date.now();
}

function AssignmentsList() {
  const { colors, spacing, fontSize } = useTheme();
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState<Filter>('all');

  const { items, loading, refreshing, error, onRefresh, refetch } = useApiList<AssignmentRow>(
    '/training/assignments',
    { channel: 'training' },
  );

  const counts = useMemo(
    () => ({
      all: items.length,
      in_progress: items.filter((a) => !isDone(a) && (a.progress_percentage ?? 0) > 0).length,
      overdue: items.filter(isOverdue).length,
      completed: items.filter(isDone).length,
    }),
    [items],
  );

  const filtered = useMemo(() => {
    switch (filter) {
      case 'overdue':
        return items.filter(isOverdue);
      case 'in_progress':
        return items.filter((a) => !isDone(a) && (a.progress_percentage ?? 0) > 0);
      case 'completed':
        return items.filter(isDone);
      default:
        return items;
    }
  }, [items, filter]);

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: false }} />
      <PageTopBar title="Assignments" subtitle={`${items.length} total`} />
      <ListScreen
        items={filtered}
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
              { key: 'overdue', label: 'Overdue', count: counts.overdue },
              { key: 'completed', label: 'Complete', count: counts.completed },
            ]}
          />
        }
        emptyTitle={filter === 'overdue' ? 'Nothing overdue' : 'No assignments'}
        emptyDescription="Assign a course to your team to start tracking."
        renderItem={({ item }) => {
          const pct = Math.max(0, Math.min(100, Math.round(item.progress_percentage ?? 0)));
          const done = isDone(item);
          const overdue = isOverdue(item);
          const statusColor = done ? colors.success : overdue ? colors.danger : colors.accent;
          const statusLabel = done ? 'Complete' : overdue ? 'Overdue' : `${pct}%`;

          return (
            <View
              style={{
                paddingHorizontal: spacing.lg,
                paddingVertical: spacing.md,
                gap: spacing.sm,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                <Avatar
                  id={item.assignee?.id}
                  name={item.assignee?.full_name}
                  email={item.assignee?.email}
                  size={34}
                />
                <View style={{ flex: 1 }}>
                  <Text
                    numberOfLines={1}
                    style={{ fontSize: fontSize.base, fontWeight: '600', color: colors.ink }}
                  >
                    {item.assignee?.full_name?.trim() || item.assignee?.email || 'Assigned user'}
                  </Text>
                  <Text numberOfLines={1} style={{ fontSize: fontSize.sm, color: colors.muted }}>
                    {item.course?.title ?? 'Course'}
                    {item.due_date ? ` · Due ${shortDate(item.due_date)}` : ''}
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <View
                    style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: statusColor }}
                  />
                  <Text style={{ fontSize: fontSize.xs, fontWeight: '700', color: statusColor }}>
                    {statusLabel}
                  </Text>
                </View>
              </View>

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
            </View>
          );
        }}
      />
    </Screen>
  );
}
