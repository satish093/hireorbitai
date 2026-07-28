import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Screen, Banner } from '../../../src/components/ui/Screen';
import { PageTopBar } from '../../../src/components/ui/TopBar';
import { Card, SectionHeader, Divider } from '../../../src/components/ui/Card';
import { Pill } from '../../../src/components/ui/Pill';
import { Button } from '../../../src/components/ui/Button';
import { SkeletonList, EmptyState } from '../../../src/components/ui/States';
import { RouteGuard } from '../../../src/components/RouteGuard';
import { useApiQuery } from '../../../src/hooks/useApi';
import { api, apiErrorMessage } from '../../../src/services/api';
import { BUSINESS_ROLES } from '../../../src/types';
import { useTheme } from '../../../src/theme';

interface PlanItem {
  id: string;
  week_no?: number | null;
  week_label?: string | null;
  focus_area?: string | null;
  title: string;
  item_type?: string | null;
  duration_min?: number | null;
  course_id?: string | null;
  completed?: boolean | null;
}

interface StudyPlan {
  id: string;
  title?: string | null;
  rationale?: string | null;
  items?: PlanItem[] | null;
  created_at?: string;
}

/**
 * AI study plan — GET /training/plans/active, POST /training/plans/generate (no
 * body), PATCH /training/plans/items/:id { completed }.
 *
 * Generation spends budget, so it is an explicit button rather than firing on
 * mount. Ticking an item is optimistic and reverts on failure.
 */
export default function StudyPlanScreen() {
  return (
    <RouteGuard allow={[...BUSINESS_ROLES]} feature="training">
      <StudyPlanView />
    </RouteGuard>
  );
}

function StudyPlanView() {
  const { colors, spacing, fontSize } = useTheme();
  const insets = useSafeAreaInsets();
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const plan = useApiQuery<StudyPlan | null>('/training/plans/active', { channel: 'training' });

  // Backend already returns items ordered by week_no, sort_order.
  const items = plan.data?.items ?? [];

  const generate = async () => {
    setGenerating(true);
    setError(null);
    try {
      await api.post('/training/plans/generate', {});
      await plan.refetch();
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not generate a plan right now.'));
    } finally {
      setGenerating(false);
    }
  };

  const toggle = async (item: PlanItem) => {
    const next = !item.completed;
    // Optimistic.
    plan.setData((prev) =>
      prev
        ? {
            ...prev,
            items: (prev.items ?? []).map((it) =>
              it.id === item.id ? { ...it, completed: next } : it,
            ),
          }
        : null,
    );
    try {
      await api.patch(`/training/plans/items/${item.id}`, { completed: next });
    } catch (err) {
      // Revert.
      plan.setData((prev) =>
        prev
          ? {
              ...prev,
              items: (prev.items ?? []).map((it) =>
                it.id === item.id ? { ...it, completed: !next } : it,
              ),
            }
          : null,
      );
      setError(apiErrorMessage(err, 'Could not update that step.'));
    }
  };

  const completed = items.filter((i) => i.completed).length;

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: false }} />
      <PageTopBar
        title="Study plan"
        subtitle={items.length ? `${completed} of ${items.length} done` : 'Personalised for you'}
      />
      <ScrollView
        style={{ flex: 1 }}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          padding: spacing.lg,
          paddingBottom: spacing['4xl'] + insets.bottom,
          gap: spacing.lg,
        }}
        refreshControl={
          <RefreshControl
            refreshing={!!plan.refreshing}
            onRefresh={plan.onRefresh}
            tintColor={colors.accent}
            colors={[colors.accent]}
          />
        }
      >
        {error ? <Banner tone="danger" message={error} /> : null}

        {plan.loading && !plan.data ? (
          <SkeletonList count={3} />
        ) : !plan.data || items.length === 0 ? (
          <Card>
            <EmptyState
              compact
              title="No study plan yet"
              description="Generate a plan from the lessons you still have left in your enrolled courses."
            />
            <Button label="Generate my plan" onPress={generate} loading={generating} />
          </Card>
        ) : (
          <>
            <Card padded={false}>
              <View style={{ padding: spacing.lg, paddingBottom: spacing.sm }}>
                <SectionHeader
                  title={plan.data.title ?? 'Your plan'}
                  subtitle={plan.data.rationale ?? undefined}
                />
              </View>

              {items.map((item, i) => (
                <View key={item.id}>
                  {i > 0 ? <Divider inset={spacing.lg} /> : null}
                  <Pressable
                    onPress={() => void toggle(item)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: !!item.completed }}
                    style={({ pressed }) => ({
                      flexDirection: 'row',
                      alignItems: 'flex-start',
                      gap: spacing.md,
                      paddingHorizontal: spacing.lg,
                      paddingVertical: spacing.md,
                      minHeight: 52,
                      backgroundColor: pressed ? colors.hover : 'transparent',
                    })}
                  >
                    <View
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: 6,
                        borderWidth: 2,
                        borderColor: item.completed ? colors.success : colors.borderStrong,
                        backgroundColor: item.completed ? colors.success : 'transparent',
                        alignItems: 'center',
                        justifyContent: 'center',
                        marginTop: 1,
                      }}
                    >
                      {item.completed ? (
                        <Text style={{ color: '#ffffff', fontSize: 13, fontWeight: '700' }}>✓</Text>
                      ) : null}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text
                        style={{
                          fontSize: fontSize.base,
                          color: item.completed ? colors.muted : colors.ink,
                          textDecorationLine: item.completed ? 'line-through' : 'none',
                        }}
                      >
                        {item.title}
                      </Text>
                      {item.focus_area ? (
                        <Text style={{ fontSize: fontSize.sm, color: colors.muted, marginTop: 2 }}>
                          {item.focus_area}
                        </Text>
                      ) : null}
                      <View
                        style={{
                          flexDirection: 'row',
                          flexWrap: 'wrap',
                          gap: 6,
                          marginTop: 6,
                        }}
                      >
                        {item.week_label ? (
                          <Pill label={item.week_label} tone="info" size="sm" />
                        ) : null}
                        {item.item_type ? (
                          <Pill label={item.item_type} tone="neutral" size="sm" />
                        ) : null}
                        {item.duration_min ? (
                          <Pill label={`${item.duration_min} min`} tone="neutral" size="sm" />
                        ) : null}
                      </View>
                    </View>
                  </Pressable>
                </View>
              ))}
            </Card>

            <Button
              label="Regenerate plan"
              onPress={generate}
              loading={generating}
              variant="secondary"
            />
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
