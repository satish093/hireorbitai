import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Screen, ListScreen } from '../../src/components/ui/Screen';
import { PageTopBar } from '../../src/components/ui/TopBar';
import { Divider } from '../../src/components/ui/Card';
import { TASK_STATUS_TONE, TASK_PRIORITY_TONE, pillToneColor } from '../../src/components/ui/Pill';
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
  const insets = useSafeAreaInsets();

  const { items, loading, refreshing, error, onRefresh, refetch } = useApiList<Task>(
    '/tasks/assigned-to-me',
    { channel: 'tasks' },
  );

  return (
    <Screen edges={['top']}>
      <PageTopBar title="Assigned to me" subtitle={`${items.length} open`} showBack />
      <ListScreen
        items={items}
        loading={loading}
        refreshing={refreshing}
        error={error}
        onRefresh={onRefresh}
        onRetry={() => void refetch()}
        keyExtractor={(t) => t.id}
        ItemSeparatorComponent={() => <Divider />}
        contentContainerStyle={{
          paddingHorizontal: spacing.lg,
          paddingTop: spacing.sm,
          paddingBottom: spacing['4xl'] + insets.bottom,
          flexGrow: 1,
        }}
        emptyTitle="Nothing assigned to you"
        emptyDescription="Tasks someone assigns you will show up here."
        renderItem={({ item }) => {
          const overdue = !!item.due_at && new Date(item.due_at).getTime() < Date.now();
          return (
            <Pressable
              onPress={() => router.push(`/(app)/task/${item.id}`)}
              accessibilityRole="button"
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'flex-start',
                gap: spacing.md,
                paddingVertical: 12,
                backgroundColor: pressed ? colors.hover : 'transparent',
              })}
            >
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text
                  numberOfLines={1}
                  style={{ fontSize: fontSize.md, fontWeight: '600', color: colors.ink }}
                >
                  {item.title}
                </Text>
                {item.description ? (
                  <Text numberOfLines={1} style={{ fontSize: fontSize.sm, color: colors.muted }}>
                    {item.description}
                  </Text>
                ) : null}
                <View
                  style={{
                    flexDirection: 'row',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    gap: spacing.sm,
                    marginTop: 3,
                  }}
                >
                  {item.priority ? (
                    <Text
                      style={{
                        fontSize: fontSize.xs,
                        fontWeight: '600',
                        color: pillToneColor(
                          TASK_PRIORITY_TONE[item.priority] ?? 'neutral',
                          colors,
                        ),
                      }}
                    >
                      {item.priority}
                    </Text>
                  ) : null}
                  {item.due_at ? (
                    <Text
                      style={{
                        fontSize: fontSize.xs,
                        fontWeight: '600',
                        color: overdue ? colors.danger : colors.muted,
                      }}
                    >
                      Due {new Date(item.due_at).toLocaleDateString()}
                    </Text>
                  ) : null}
                </View>
              </View>
              <StatusText
                label={TASK_STATUS_LABEL[item.status] ?? item.status}
                color={pillToneColor(TASK_STATUS_TONE[item.status] ?? 'neutral', colors)}
              />
            </Pressable>
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
