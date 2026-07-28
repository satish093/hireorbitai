import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ListScreen, PageHeader } from '../../../src/components/ui/Screen';
import { Card } from '../../../src/components/ui/Card';
import { Pill, type PillTone } from '../../../src/components/ui/Pill';
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
function statusTone(status?: string | null): PillTone {
  if (status === 'ACTIVE') return 'success';
  if (status === 'ARCHIVED') return 'warn';
  return 'neutral';
}

function CoursesList() {
  const router = useRouter();
  const { colors, spacing, fontSize } = useTheme();
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
          <View style={{ gap: spacing.sm }}>
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
          return (
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
                  label={(item.status ?? 'DRAFT').toLowerCase()}
                  tone={statusTone(item.status)}
                  size="sm"
                />
              </View>

              <View
                style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.md }}
              >
                {item.category ? <Pill label={item.category} tone="brand" size="sm" /> : null}
                {item.difficulty ? (
                  <Pill label={item.difficulty.toLowerCase()} tone="neutral" size="sm" />
                ) : null}
                {typeof lc === 'number' ? (
                  <Pill label={`${lc} lessons`} tone="info" size="sm" />
                ) : null}
              </View>
            </Card>
          );
        }}
      />
    </>
  );
}
