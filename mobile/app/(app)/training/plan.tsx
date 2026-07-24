import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { ScreenScroll, PageHeader, Banner } from '../../../src/components/ui/Screen';
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
  title: string;
  description?: string | null;
  done?: boolean | null;
  order_index?: number | null;
  target_date?: string | null;
}

interface StudyPlan {
  id: string;
  title?: string | null;
  items?: PlanItem[] | null;
  created_at?: string;
}

/**
 * AI study plan — GET /training/plans/active, POST /training/plans/generate,
 * PATCH /training/plans/items/:id.
 *
 * Generation spends AI budget, so it is an explicit button rather than
 * something that fires on mount. Ticking an item is optimistic and reverts on
 * failure — a checkbox that silently didn't save is worse than one that visibly
 * refuses.
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
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const plan = useApiQuery<StudyPlan | null>('/training/plans/active', { channel: 'training' });

  const items = [...(plan.data?.items ?? [])].sort(
    (a, b) => (a.order_index ?? 0) - (b.order_index ?? 0),
  );

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
    const next = !item.done;
    // Optimistic.
    plan.setData((prev) =>
      prev
        ? {
            ...prev,
            items: (prev.items ?? []).map((it) => (it.id === item.id ? { ...it, done: next } : it)),
          }
        : null,
    );
    try {
      await api.patch(`/training/plans/items/${item.id}`, { done: next });
    } catch (err) {
      // Revert.
      plan.setData((prev) =>
        prev
          ? {
              ...prev,
              items: (prev.items ?? []).map((it) =>
                it.id === item.id ? { ...it, done: !next } : it,
              ),
            }
          : null,
      );
      setError(apiErrorMessage(err, 'Could not update that step.'));
    }
  };

  const completed = items.filter((i) => i.done).length;

  return (
    <ScreenScroll refreshing={plan.refreshing} onRefresh={plan.onRefresh} edges={[]}>
      <PageHeader
        title="Study plan"
        subtitle={items.length ? `${completed} of ${items.length} done` : 'Personalised for you'}
      />

      {error ? <Banner tone="danger" message={error} /> : null}

      {plan.loading && !plan.data ? (
        <SkeletonList count={3} />
      ) : !plan.data || items.length === 0 ? (
        <Card>
          <EmptyState
            compact
            title="No study plan yet"
            description="Generate a plan based on your assigned courses and skill gaps."
          />
          <Button label="Generate my plan" onPress={generate} loading={generating} />
        </Card>
      ) : (
        <>
          <Card padded={false}>
            <View style={{ padding: spacing.lg, paddingBottom: spacing.sm }}>
              <SectionHeader title={plan.data.title ?? 'Your plan'} />
            </View>

            {items.map((item, i) => (
              <View key={item.id}>
                {i > 0 ? <Divider inset={spacing.lg} /> : null}
                <Pressable
                  onPress={() => void toggle(item)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: !!item.done }}
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
                      borderColor: item.done ? colors.success : colors.borderStrong,
                      backgroundColor: item.done ? colors.success : 'transparent',
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginTop: 1,
                    }}
                  >
                    {item.done ? (
                      <Text style={{ color: '#ffffff', fontSize: 13, fontWeight: '700' }}>✓</Text>
                    ) : null}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={{
                        fontSize: fontSize.base,
                        color: item.done ? colors.muted : colors.ink,
                        textDecorationLine: item.done ? 'line-through' : 'none',
                      }}
                    >
                      {item.title}
                    </Text>
                    {item.description ? (
                      <Text style={{ fontSize: fontSize.sm, color: colors.muted, marginTop: 2 }}>
                        {item.description}
                      </Text>
                    ) : null}
                    {item.target_date ? (
                      <View style={{ marginTop: 6 }}>
                        <Pill
                          label={new Date(item.target_date).toLocaleDateString()}
                          tone="info"
                          size="sm"
                        />
                      </View>
                    ) : null}
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
    </ScreenScroll>
  );
}
