import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Screen, ListScreen } from '../../../src/components/ui/Screen';
import { PageTopBar } from '../../../src/components/ui/TopBar';
import { Divider } from '../../../src/components/ui/Card';
import { Button } from '../../../src/components/ui/Button';
import { Tabs } from '../../../src/components/ui/Tabs';
import { SearchInput } from '../../../src/components/ui/Inputs';
import { RouteGuard } from '../../../src/components/RouteGuard';
import { useApiList } from '../../../src/hooks/useApi';
import { MANAGER_TIER } from '../../../src/types';
import { useTheme } from '../../../src/theme';

/**
 * Course catalog — GET /training/courses. MANAGER_TIER (admin view, drafts
 * included). Learners use training/my (GET /training/my-training).
 */
export default function TrainingCoursesScreen() {
  return (
    <RouteGuard allow={[...MANAGER_TIER]} feature="training">
      <CoursesList />
    </RouteGuard>
  );
}

interface CourseRow {
  id: string;
  title: string;
  description?: string | null;
  category?: string | null;
  difficulty?: string | null;
  status?: string | null;
  lessons?: Array<{ count: number }> | number | null;
}

type StatusFilter = 'all' | 'ACTIVE' | 'DRAFT' | 'ARCHIVED';

function lessonCount(c: CourseRow): number | null {
  if (Array.isArray(c.lessons)) return c.lessons[0]?.count ?? 0;
  if (typeof c.lessons === 'number') return c.lessons;
  return null;
}

function CoursesList() {
  const router = useRouter();
  const { colors, spacing, fontSize } = useTheme();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');

  const { items, loading, refreshing, error, onRefresh, refetch } = useApiList<CourseRow>(
    '/training/courses',
    { channel: 'training' },
  );

  const counts = useMemo(
    () => ({
      all: items.length,
      ACTIVE: items.filter((c) => c.status === 'ACTIVE').length,
      DRAFT: items.filter((c) => c.status === 'DRAFT' || !c.status).length,
      ARCHIVED: items.filter((c) => c.status === 'ARCHIVED').length,
    }),
    [items],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((c) => {
      if (status !== 'all') {
        const s = c.status ?? 'DRAFT';
        if (s !== status) return false;
      }
      if (!q) return true;
      return c.title?.toLowerCase().includes(q) || (c.category ?? '').toLowerCase().includes(q);
    });
  }, [items, query, status]);

  const statusMeta = (s?: string | null): { color: string; label: string } => {
    if (s === 'ACTIVE') return { color: colors.success, label: 'Active' };
    if (s === 'ARCHIVED') return { color: colors.warn, label: 'Archived' };
    return { color: colors.faint, label: 'Draft' };
  };

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: false }} />
      <PageTopBar
        title="Courses"
        subtitle={`${items.length} in catalog`}
        right={
          <Button
            label="New"
            href="/(app)/training/create"
            size="sm"
            block={false}
            variant="secondary"
          />
        }
      />
      <ListScreen
        items={filtered}
        loading={loading}
        refreshing={refreshing}
        error={error}
        onRefresh={onRefresh}
        onRetry={() => void refetch()}
        keyExtractor={(c) => c.id}
        ItemSeparatorComponent={() => <Divider inset={spacing.lg} />}
        contentContainerStyle={{
          paddingBottom: spacing['4xl'] + insets.bottom,
          flexGrow: 1,
        }}
        header={
          <View style={{ gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.md }}>
            <SearchInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search title or category"
            />
            <Tabs
              value={status}
              onChange={(k) => setStatus(k as StatusFilter)}
              items={[
                { key: 'all', label: 'All', count: counts.all },
                { key: 'ACTIVE', label: 'Active', count: counts.ACTIVE },
                { key: 'DRAFT', label: 'Draft', count: counts.DRAFT },
                { key: 'ARCHIVED', label: 'Archived', count: counts.ARCHIVED },
              ]}
            />
          </View>
        }
        emptyTitle={query || status !== 'all' ? 'No matches' : 'No courses'}
        emptyDescription="Create a course or generate one with AI."
        emptyActionLabel={query || status !== 'all' ? undefined : 'Create a course'}
        onEmptyAction={
          query || status !== 'all' ? undefined : () => router.push('/(app)/training/create')
        }
        renderItem={({ item }) => {
          const lc = lessonCount(item);
          const st = statusMeta(item.status);
          const meta = [
            item.category,
            item.difficulty ? item.difficulty.toLowerCase() : null,
            typeof lc === 'number' ? `${lc} lessons` : null,
          ]
            .filter(Boolean)
            .join(' · ');

          return (
            <Pressable
              onPress={() => router.push(`/(app)/training/course/${item.id}`)}
              style={({ pressed }) => ({
                paddingHorizontal: spacing.lg,
                paddingVertical: spacing.md,
                backgroundColor: pressed ? colors.hover : 'transparent',
                gap: 4,
              })}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                <Text
                  numberOfLines={1}
                  style={{ flex: 1, fontSize: fontSize.base, fontWeight: '600', color: colors.ink }}
                >
                  {item.title}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <View
                    style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: st.color }}
                  />
                  <Text style={{ fontSize: fontSize.xs, fontWeight: '700', color: st.color }}>
                    {st.label}
                  </Text>
                </View>
              </View>

              {item.description ? (
                <Text numberOfLines={2} style={{ fontSize: fontSize.sm, color: colors.ink2 }}>
                  {item.description}
                </Text>
              ) : null}
              {meta ? (
                <Text numberOfLines={1} style={{ fontSize: fontSize.xs, color: colors.muted }}>
                  {meta}
                </Text>
              ) : null}
            </Pressable>
          );
        }}
      />
    </Screen>
  );
}
