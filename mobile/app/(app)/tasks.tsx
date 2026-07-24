import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ListScreen, PageHeader } from '../../src/components/ui/Screen';
import { Card } from '../../src/components/ui/Card';
import { Pill, TASK_STATUS_TONE, TASK_PRIORITY_TONE } from '../../src/components/ui/Pill';
import { Avatar } from '../../src/components/ui/Avatar';
import { RouteGuard } from '../../src/components/RouteGuard';
import { useApiList } from '../../src/hooks/useApi';
import { BUSINESS_ROLES, TASK_STATUS_LABEL, type Task, type TaskStatus } from '../../src/types';
import { useTheme } from '../../src/theme';

/**
 * Task list.
 *
 * The web offers a Kanban board and a table. Neither survives a phone screen —
 * a 7-column board at 390pt wide is unusable, and horizontal scrolling to reach
 * a column is worse than no board. So mobile gets a filtered list with the same
 * data, the same statuses, and the same actions.
 *
 * Due-date urgency is computed here rather than trusted from the row, because
 * "overdue" depends on the reader's clock, not the server's.
 */
export default function TasksScreen() {
  return (
    <RouteGuard allow={[...BUSINESS_ROLES]} feature="tasks">
      <TaskList />
    </RouteGuard>
  );
}

const STATUS_FILTERS: (TaskStatus | 'ALL' | 'OPEN')[] = [
  'OPEN',
  'ALL',
  'TODO',
  'IN_PROGRESS',
  'BLOCKED',
  'REVIEW',
  'COMPLETED',
];

const DONE_STATUSES: TaskStatus[] = ['COMPLETED', 'CANCELLED'];

function TaskList() {
  const router = useRouter();
  const { colors, spacing, fontSize, radius } = useTheme();
  const [filter, setFilter] = useState<TaskStatus | 'ALL' | 'OPEN'>('OPEN');

  const { items, loading, refreshing, error, onRefresh, refetch } = useApiList<Task>('/tasks', {
    channel: 'tasks',
  });

  const filtered = useMemo(() => {
    if (filter === 'ALL') return items;
    if (filter === 'OPEN') return items.filter((t) => !DONE_STATUSES.includes(t.status));
    return items.filter((t) => t.status === filter);
  }, [items, filter]);

  return (
    <>
      <PageHeader title="Tasks" subtitle={`${items.length} total`} />
      <ListScreen
        items={filtered}
        loading={loading}
        refreshing={refreshing}
        error={error}
        onRefresh={onRefresh}
        onRetry={() => void refetch()}
        keyExtractor={(t) => t.id}
        header={
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: spacing.sm, paddingVertical: 2 }}
          >
            {STATUS_FILTERS.map((s) => {
              const active = s === filter;
              const label =
                s === 'ALL'
                  ? 'All'
                  : s === 'OPEN'
                    ? 'Open'
                    : (TASK_STATUS_LABEL[s as TaskStatus] ?? s);
              return (
                <Pressable
                  key={s}
                  onPress={() => setFilter(s)}
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
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        }
        emptyTitle={filter === 'OPEN' ? 'Nothing open' : 'No tasks'}
        emptyDescription="Tasks assigned to you or your team will show up here."
        renderItem={({ item }) => {
          const due = dueMeta(item.due_at, item.status);
          return (
            <Card onPress={() => router.push(`/(app)/task/${item.id}`)}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md }}>
                <View style={{ flex: 1 }}>
                  <Text
                    numberOfLines={2}
                    style={{
                      fontSize: fontSize.md,
                      fontWeight: '600',
                      color: colors.ink,
                      textDecorationLine:
                        item.status === 'COMPLETED' || item.status === 'CANCELLED'
                          ? 'line-through'
                          : 'none',
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
                </View>
                {item.assignee ? (
                  <Avatar
                    id={item.assignee.id}
                    name={item.assignee.full_name}
                    email={item.assignee.email}
                    size={32}
                  />
                ) : null}
              </View>

              <View
                style={{
                  flexDirection: 'row',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  gap: 6,
                  marginTop: spacing.md,
                }}
              >
                <Pill
                  label={TASK_STATUS_LABEL[item.status] ?? item.status}
                  tone={TASK_STATUS_TONE[item.status] ?? 'neutral'}
                  size="sm"
                />
                {item.priority ? (
                  <Pill
                    label={item.priority}
                    tone={TASK_PRIORITY_TONE[item.priority] ?? 'neutral'}
                    size="sm"
                  />
                ) : null}
                {due ? <Pill label={due.label} tone={due.tone} size="sm" /> : null}
              </View>
            </Card>
          );
        }}
      />
    </>
  );
}

/**
 * Due-date chip. Returns null for a task with no due date, and stays neutral
 * once the task is done — an overdue-red badge on a completed task is noise.
 */
function dueMeta(
  dueAt: string | null | undefined,
  status: TaskStatus,
): { label: string; tone: 'neutral' | 'warn' | 'danger' | 'info' } | null {
  if (!dueAt) return null;
  const due = new Date(dueAt).getTime();
  if (Number.isNaN(due)) return null;
  if (DONE_STATUSES.includes(status)) {
    return { label: `Due ${new Date(dueAt).toLocaleDateString()}`, tone: 'neutral' };
  }

  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const diff = due - now;

  if (diff < 0) return { label: 'Overdue', tone: 'danger' };
  if (diff < day) return { label: 'Due today', tone: 'warn' };
  if (diff < 2 * day) return { label: 'Due tomorrow', tone: 'warn' };
  return { label: `Due ${new Date(dueAt).toLocaleDateString()}`, tone: 'info' };
}
