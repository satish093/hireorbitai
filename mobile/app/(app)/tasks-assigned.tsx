import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ListScreen, PageHeader } from '../../src/components/ui/Screen';
import { Card } from '../../src/components/ui/Card';
import { Pill, TASK_STATUS_TONE, TASK_PRIORITY_TONE } from '../../src/components/ui/Pill';
import { RouteGuard } from '../../src/components/RouteGuard';
import { useApiList } from '../../src/hooks/useApi';
import { BUSINESS_ROLES, TASK_STATUS_LABEL, type Task } from '../../src/types';
import { useTheme } from '../../src/theme';

/**
 * Tasks assigned to me — GET /tasks/assigned-to-me.
 *
 * No role gate beyond BUSINESS_ROLES: the endpoint is self-scoped by
 * req.user.id server-side, so every user gets exactly their own list. Same
 * endpoint that feeds the tab-bar badge.
 */
export default function TasksAssignedScreen() {
  return (
    <RouteGuard allow={[...BUSINESS_ROLES]} feature="tasks">
      <AssignedTasks />
    </RouteGuard>
  );
}

function AssignedTasks() {
  const router = useRouter();
  const { colors, spacing, fontSize } = useTheme();

  const { items, loading, refreshing, error, onRefresh, refetch } = useApiList<Task>(
    '/tasks/assigned-to-me',
    { channel: 'tasks' },
  );

  return (
    <>
      <PageHeader title="Assigned to me" subtitle={`${items.length} open`} />
      <ListScreen
        items={items}
        loading={loading}
        refreshing={refreshing}
        error={error}
        onRefresh={onRefresh}
        onRetry={() => void refetch()}
        keyExtractor={(t) => t.id}
        emptyTitle="Nothing assigned to you"
        emptyDescription="Tasks someone assigns you will show up here."
        renderItem={({ item }) => (
          <Card onPress={() => router.push(`/(app)/task/${item.id}`)}>
            <Text
              numberOfLines={2}
              style={{ fontSize: fontSize.md, fontWeight: '600', color: colors.ink }}
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
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.md }}>
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
              {item.due_at ? (
                <Pill
                  label={`Due ${new Date(item.due_at).toLocaleDateString()}`}
                  tone={new Date(item.due_at).getTime() < Date.now() ? 'danger' : 'info'}
                  size="sm"
                />
              ) : null}
            </View>
          </Card>
        )}
      />
    </>
  );
}
