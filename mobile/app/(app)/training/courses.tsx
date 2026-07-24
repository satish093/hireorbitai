import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ListScreen, PageHeader } from '../../../src/components/ui/Screen';
import { Card } from '../../../src/components/ui/Card';
import { Pill } from '../../../src/components/ui/Pill';
import { Button } from '../../../src/components/ui/Button';
import { SearchInput } from '../../../src/components/ui/Inputs';
import { RouteGuard } from '../../../src/components/RouteGuard';
import { useApiList } from '../../../src/hooks/useApi';
import { MANAGER_TIER, type TrainingCourse } from '../../../src/types';
import { useTheme } from '../../../src/theme';

/**
 * Course catalog — GET /training/courses. MANAGER_TIER.
 *
 * This is the ADMIN view of the catalog (drafts included). The learner-facing
 * list is training/my, which reads /training/my-training and is open to every
 * business role.
 */
export default function TrainingCoursesScreen() {
  return (
    <RouteGuard allow={[...MANAGER_TIER]} feature="training">
      <CoursesList />
    </RouteGuard>
  );
}

function CoursesList() {
  const router = useRouter();
  const { colors, spacing, fontSize } = useTheme();
  const [query, setQuery] = useState('');

  const { items, loading, refreshing, error, onRefresh, refetch } = useApiList<TrainingCourse>(
    '/training/courses',
    { channel: 'training' },
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (c) => c.title?.toLowerCase().includes(q) || c.category?.toLowerCase().includes(q),
    );
  }, [items, query]);

  return (
    <>
      <PageHeader
        title="Courses"
        subtitle={`${items.length} in catalog`}
        action={
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
        header={
          <SearchInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search title or category"
          />
        }
        emptyTitle={query ? 'No matches' : 'No courses'}
        emptyDescription="Create a course or generate one with AI."
        emptyActionLabel={query ? undefined : 'Create a course'}
        onEmptyAction={query ? undefined : () => router.push('/(app)/training/create')}
        renderItem={({ item }) => (
          <Card onPress={() => router.push(`/(app)/training/course/${item.id}`)}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md }}>
              <View style={{ flex: 1 }}>
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
              </View>
              <Pill
                label={item.is_published ? 'Published' : 'Draft'}
                tone={item.is_published ? 'success' : 'neutral'}
                size="sm"
              />
            </View>

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.md }}>
              {item.category ? <Pill label={item.category} tone="brand" size="sm" /> : null}
              {typeof item.lesson_count === 'number' ? (
                <Pill label={`${item.lesson_count} lessons`} tone="info" size="sm" />
              ) : null}
            </View>
          </Card>
        )}
      />
    </>
  );
}
