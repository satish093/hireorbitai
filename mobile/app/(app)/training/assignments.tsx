import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { ListScreen, PageHeader } from '../../../src/components/ui/Screen';
import { Card } from '../../../src/components/ui/Card';
import { Pill } from '../../../src/components/ui/Pill';
import { Avatar } from '../../../src/components/ui/Avatar';
import { RouteGuard } from '../../../src/components/RouteGuard';
import { useApiList } from '../../../src/hooks/useApi';
import { MANAGER_TIER, type TrainingAssignment, type UserRef } from '../../../src/types';
import { useTheme } from '../../../src/theme';

interface AssignmentRow extends TrainingAssignment {
  user?: UserRef | null;
}

/**
 * Assignment tracking — GET /training/assignments. MANAGER_TIER.
 *
 * The org-wide view of who has been assigned what. Compliance training has due
 * dates that matter (I-983, security awareness), so overdue is filtered first
 * and coloured — that is the state anyone opens this screen to chase.
 */
export default function TrainingAssignmentsScreen() {
  return (
    <RouteGuard allow={[...MANAGER_TIER]} feature="training">
      <AssignmentsList />
    </RouteGuard>
  );
}

const FILTERS = ['OVERDUE', 'ALL', 'IN_PROGRESS', 'COMPLETE'] as const;

function AssignmentsList() {
  const { colors, spacing, fontSize, radius } = useTheme();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('ALL');

  const { items, loading, refreshing, error, onRefresh, refetch } = useApiList<AssignmentRow>(
    '/training/assignments',
    { channel: 'training' },
  );

  const filtered = useMemo(() => {
    const now = Date.now();
    const isDone = (a: AssignmentRow) => !!a.completed_at || (a.progress_percent ?? 0) >= 100;
    switch (filter) {
      case 'OVERDUE':
        return items.filter((a) => !isDone(a) && !!a.due_at && new Date(a.due_at).getTime() < now);
      case 'IN_PROGRESS':
        return items.filter((a) => !isDone(a) && (a.progress_percent ?? 0) > 0);
      case 'COMPLETE':
        return items.filter(isDone);
      default:
        return items;
    }
  }, [items, filter]);

  return (
    <>
      <PageHeader title="Assignments" subtitle={`${items.length} total`} />
      <ListScreen
        items={filtered}
        loading={loading}
        refreshing={refreshing}
        error={error}
        onRefresh={onRefresh}
        onRetry={() => void refetch()}
        keyExtractor={(a) => a.id}
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
                    {f === 'ALL' ? 'All' : f.charAt(0) + f.slice(1).toLowerCase().replace('_', ' ')}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        }
        emptyTitle={filter === 'OVERDUE' ? 'Nothing overdue' : 'No assignments'}
        emptyDescription="Assign a course to your team to start tracking."
        renderItem={({ item }) => {
          const pct = Math.max(0, Math.min(100, Math.round(item.progress_percent ?? 0)));
          const done = !!item.completed_at || pct >= 100;
          const overdue = !done && !!item.due_at && new Date(item.due_at).getTime() < Date.now();
          return (
            <Card>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                <Avatar
                  id={item.user?.id ?? item.user_id}
                  name={item.user?.full_name}
                  email={item.user?.email}
                  size={36}
                />
                <View style={{ flex: 1 }}>
                  <Text
                    numberOfLines={1}
                    style={{ fontSize: fontSize.base, fontWeight: '600', color: colors.ink }}
                  >
                    {item.user?.full_name?.trim() || item.user?.email || 'Assigned user'}
                  </Text>
                  <Text numberOfLines={1} style={{ fontSize: fontSize.sm, color: colors.muted }}>
                    {item.course?.title ?? 'Course'}
                  </Text>
                </View>
                {done ? (
                  <Pill label="Complete" tone="success" size="sm" />
                ) : overdue ? (
                  <Pill label="Overdue" tone="danger" size="sm" />
                ) : (
                  <Pill label={`${pct}%`} tone="info" size="sm" />
                )}
              </View>

              <View
                style={{
                  height: 6,
                  borderRadius: radius.pill,
                  backgroundColor: colors.hover,
                  overflow: 'hidden',
                  marginTop: spacing.md,
                }}
              >
                <View
                  style={{
                    width: `${pct}%`,
                    height: '100%',
                    backgroundColor: done
                      ? colors.success
                      : overdue
                        ? colors.danger
                        : colors.accent,
                  }}
                />
              </View>
              {item.due_at ? (
                <Text
                  style={{
                    fontSize: fontSize.xs,
                    color: overdue ? colors.danger : colors.faint,
                    marginTop: 6,
                  }}
                >
                  Due {new Date(item.due_at).toLocaleDateString()}
                </Text>
              ) : null}
            </Card>
          );
        }}
      />
    </>
  );
}
