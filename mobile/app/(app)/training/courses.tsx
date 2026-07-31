import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Screen, ListScreen, Banner } from '../../../src/components/ui/Screen';
import { PageTopBar } from '../../../src/components/ui/TopBar';
import { Card } from '../../../src/components/ui/Card';
import { Button } from '../../../src/components/ui/Button';
import { Pill, type PillTone } from '../../../src/components/ui/Pill';
import { SelectInput } from '../../../src/components/ui/Inputs';
import { RouteGuard } from '../../../src/components/RouteGuard';
import { useApiList, useApiMutation } from '../../../src/hooks/useApi';
import { useAuth } from '../../../src/context/AuthContext';
import { MANAGER_TIER, ADMIN_TIER } from '../../../src/types';
import { useTheme } from '../../../src/theme';

/**
 * Course catalog — GET /training/courses. MANAGER_TIER (admin view, drafts
 * included). Mirrors the web catalog: two filter dropdowns (status, category),
 * an admin-only "Fill in missing materials" backfill + a "New course" button,
 * and cards with a generated gradient cover banner keyed off the category.
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
  content_status?: string | null;
  thumbnail_url?: string | null;
  lessons?: Array<{ count: number }> | number | null;
  assignments?: Array<{ count: number }> | number | null;
}

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'ARCHIVED', label: 'Archived' },
];

function countOf(v: CourseRow['lessons']): number | null {
  if (Array.isArray(v)) return v[0]?.count ?? 0;
  if (typeof v === 'number') return v;
  return null;
}

function CoursesList() {
  const router = useRouter();
  const { colors, spacing, fontSize } = useTheme();
  const insets = useSafeAreaInsets();
  const { profile } = useAuth();
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const { items, loading, refreshing, error, onRefresh, refetch } = useApiList<CourseRow>(
    '/training/courses',
    { channel: 'training' },
  );

  const isAdmin = !!profile && (ADMIN_TIER as readonly string[]).includes(profile.role);
  const backfill = useApiMutation('post', '/training/courses/backfill', {
    invalidates: ['training'],
  });

  const categoryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const c of items) if (c.category) set.add(c.category);
    return [
      { value: '', label: 'All categories' },
      ...[...set].sort().map((c) => ({ value: c, label: c })),
    ];
  }, [items]);

  const filtered = useMemo(
    () =>
      items.filter((c) => {
        if (status && (c.status ?? 'DRAFT') !== status) return false;
        if (category && c.category !== category) return false;
        return true;
      }),
    [items, status, category],
  );

  const runBackfill = async () => {
    setNotice(null);
    const res = await backfill.mutate();
    if (res) {
      setNotice('Backfill started — missing lesson materials are being generated.');
      void refetch();
    }
  };

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: false }} />
      <PageTopBar title="Courses" showBack />
      <ListScreen
        items={filtered}
        loading={loading}
        refreshing={refreshing}
        error={error}
        onRefresh={onRefresh}
        onRetry={() => void refetch()}
        keyExtractor={(c) => c.id}
        contentContainerStyle={{
          paddingHorizontal: spacing.lg,
          paddingBottom: spacing['4xl'] + insets.bottom,
          flexGrow: 1,
        }}
        header={
          <View style={{ gap: spacing.md, paddingTop: spacing.sm, marginBottom: spacing.sm }}>
            <View>
              <Text style={{ fontSize: fontSize.xl, fontWeight: '800', color: colors.ink }}>
                Courses
              </Text>
              <Text style={{ fontSize: fontSize.sm, color: colors.muted, marginTop: 4 }}>
                Workspace-wide — every manager-tier user sees the same course catalog.
              </Text>
            </View>

            <View style={{ flexDirection: 'row', gap: spacing.md }}>
              <View style={{ flex: 1 }}>
                <SelectInput value={status} options={STATUS_OPTIONS} onChange={setStatus} />
              </View>
              <View style={{ flex: 1 }}>
                <SelectInput value={category} options={categoryOptions} onChange={setCategory} />
              </View>
            </View>

            <View style={{ flexDirection: 'row', gap: spacing.md }}>
              {isAdmin ? (
                <View style={{ flex: 1 }}>
                  <Button
                    label={backfill.pending ? 'Working…' : '✦ Fill in missing materials'}
                    variant="accent"
                    size="sm"
                    loading={backfill.pending}
                    onPress={runBackfill}
                  />
                </View>
              ) : null}
              <View style={{ flex: isAdmin ? 0 : 1, minWidth: 150 }}>
                <Button
                  label="+ New course"
                  href="/(app)/training/create"
                  size="sm"
                  block={!isAdmin}
                />
              </View>
            </View>

            {backfill.error ? <Banner tone="danger" message={backfill.error} /> : null}
            {notice ? <Banner tone="success" message={notice} /> : null}
          </View>
        }
        emptyTitle={status || category ? 'No matches' : 'No courses'}
        emptyDescription="Create a course or generate one with AI."
        emptyActionLabel={status || category ? undefined : 'Create a course'}
        onEmptyAction={status || category ? undefined : () => router.push('/(app)/training/create')}
        renderItem={({ item }) => (
          <CourseCard
            course={item}
            onPress={() => router.push(`/(app)/training/course/${item.id}`)}
          />
        )}
      />
    </Screen>
  );
}

function CourseCard({ course, onPress }: { course: CourseRow; onPress: () => void }) {
  const { colors, spacing, fontSize } = useTheme();
  const lessons = countOf(course.lessons);
  const assigned = countOf(course.assignments);
  const statusTone: PillTone =
    course.status === 'ACTIVE' ? 'success' : course.status === 'ARCHIVED' ? 'warn' : 'neutral';
  const statusLabel =
    course.status === 'ACTIVE' ? 'Active' : course.status === 'ARCHIVED' ? 'Archived' : 'Draft';

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1, marginBottom: spacing.lg })}
    >
      <Card padded={false}>
        <CourseCover category={course.category} id={course.id} />
        <View style={{ padding: spacing.lg, gap: spacing.sm }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
            {course.category ? <Pill label={course.category} tone="brand" size="sm" /> : null}
            <Pill label={statusLabel} tone={statusTone} size="sm" dot />
            {course.difficulty ? (
              <Text
                style={{
                  fontSize: fontSize.xs,
                  fontWeight: '700',
                  color: colors.muted,
                  letterSpacing: 0.5,
                }}
              >
                {course.difficulty.toUpperCase()}
              </Text>
            ) : null}
            {course.content_status && course.content_status !== 'ready' ? (
              <Pill label="Needs content" tone="warn" size="sm" />
            ) : null}
          </View>

          <Text
            numberOfLines={2}
            style={{ fontSize: fontSize.md, fontWeight: '700', color: colors.ink }}
          >
            {course.title}
          </Text>

          {course.description ? (
            <Text numberOfLines={2} style={{ fontSize: fontSize.sm, color: colors.ink2 }}>
              {course.description}
            </Text>
          ) : null}

          <Text style={{ fontSize: fontSize.sm, color: colors.muted }}>
            {typeof lessons === 'number' ? `${lessons} lessons` : '— lessons'}
            {typeof assigned === 'number' ? ` · ${assigned} assigned` : ''}
          </Text>
        </View>
      </Card>
    </Pressable>
  );
}

/**
 * Generated gradient cover banner — the mobile port of the web's <CourseCover>.
 * Category drives a vivid two-stop gradient (known categories get a curated
 * pair; unknown ones a stable hue from a hash), overlaid with the uppercase
 * category label. Rendered with react-native-svg (already a dependency).
 */
function CourseCover({ category, id }: { category?: string | null; id: string }) {
  const HEIGHT = 150;
  const [from, to] = coverColors(category ?? 'General');
  const gid = `cover-${id}`;
  return (
    <View style={{ height: HEIGHT, width: '100%' }}>
      <Svg width="100%" height={HEIGHT}>
        <Defs>
          <LinearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={from} />
            <Stop offset="1" stopColor={to} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height={HEIGHT} fill={`url(#${gid})`} />
        <Circle cx="86%" cy="24%" r={HEIGHT * 0.55} fill="rgba(255,255,255,0.13)" />
        <Circle cx="14%" cy="104%" r={HEIGHT * 0.42} fill="rgba(255,255,255,0.09)" />
      </Svg>
      <View style={{ position: 'absolute', left: 18, bottom: 16 }}>
        <Text
          style={{
            color: 'rgba(255,255,255,0.96)',
            fontSize: 22,
            fontWeight: '800',
            letterSpacing: 3,
          }}
        >
          {(category ?? 'General').toUpperCase()}
        </Text>
      </View>
    </View>
  );
}

/** Curated category → [from, to] gradient pairs; hash-derived hue for the rest. */
const CATEGORY_COVER: Record<string, [string, string]> = {
  DEVOPS: ['#f59e0b', '#d97706'],
  CLOUD: ['#0ea5e9', '#0369a1'],
  FRONTEND: ['#8b5cf6', '#6d28d9'],
  BACKEND: ['#10b981', '#047857'],
  DATA: ['#3b82f6', '#1d4ed8'],
  SECURITY: ['#ef4444', '#b91c1c'],
  QA: ['#14b8a6', '#0f766e'],
  DESIGN: ['#ec4899', '#be185d'],
  MOBILE: ['#6366f1', '#4338ca'],
  AI: ['#a855f7', '#7e22ce'],
};

function coverColors(category: string): [string, string] {
  const key = category.trim().toUpperCase();
  if (CATEGORY_COVER[key]) return CATEGORY_COVER[key];
  // FNV-1a hash → stable hue.
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const hue = Math.abs(h) % 360;
  return [`hsl(${hue}, 65%, 48%)`, `hsl(${(hue + 24) % 360}, 70%, 38%)`];
}
