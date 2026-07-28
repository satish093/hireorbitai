import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Screen, ListScreen } from '../../src/components/ui/Screen';
import { PageTopBar } from '../../src/components/ui/TopBar';
import { Divider } from '../../src/components/ui/Card';
import { Tabs, type TabItem } from '../../src/components/ui/Tabs';
import { SearchInput } from '../../src/components/ui/Inputs';
import { RouteGuard } from '../../src/components/RouteGuard';
import { useApiList } from '../../src/hooks/useApi';
import { OPERATOR_TIER, type Job } from '../../src/types';
import { useTheme } from '../../src/theme';
import { displayHost } from '../../src/utils/safeUrl';
import { relativeDate } from '../../src/utils/format';
// Re-exported so the many screens that `import { relativeDate } from './jobs'`
// keep working. The implementation is Intl-free (see src/utils/format.ts).
export { relativeDate };

/**
 * Job search. OPERATOR_TIER only (the /jobs router is gated that way). Strict
 * 4-source ingestion (LinkedIn, Dice, Monster, CareerBuilder) — the source is
 * shown on every row so a policy violation is easy to notice.
 *
 * Rows follow the web's compact list: title, company · location, then a muted
 * meta line (source · type · posted · host).
 */
export default function JobsScreen() {
  return (
    <RouteGuard allow={[...OPERATOR_TIER]}>
      <JobsList />
    </RouteGuard>
  );
}

// Strict 4-source ingestion policy (LinkedIn, Dice, Monster, CareerBuilder).
const SOURCES = ['ALL', 'LinkedIn', 'Dice', 'Monster', 'CareerBuilder'] as const;

function jobSource(j: Job): string {
  return (j.publisher ?? j.source ?? '').toLowerCase();
}

function JobsList() {
  const router = useRouter();
  const { colors, spacing, fontSize } = useTheme();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [source, setSource] = useState<string>('ALL');

  const { items, loading, refreshing, error, onRefresh, refetch } = useApiList<Job>('/jobs', {
    channel: 'jobs',
  });

  // Filter locally — a keystroke-per-request would burn the rate limit, and the
  // visible page is small enough that client filtering is instant and free.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((j) => {
      if (source !== 'ALL' && !jobSource(j).includes(source.toLowerCase())) return false;
      if (!q) return true;
      return (
        j.title?.toLowerCase().includes(q) ||
        j.company_name?.toLowerCase().includes(q) ||
        j.location?.toLowerCase().includes(q)
      );
    });
  }, [items, query, source]);

  const sourceTabs: TabItem[] = SOURCES.map((s) => ({
    key: s,
    label: s === 'ALL' ? 'All' : s,
    count:
      s === 'ALL'
        ? items.length
        : items.filter((j) => jobSource(j).includes(s.toLowerCase())).length,
  }));

  return (
    <Screen edges={['top']}>
      <PageTopBar title="Jobs" subtitle={`${items.length} in your feed`} />
      <ListScreen
        items={filtered}
        loading={loading}
        refreshing={refreshing}
        error={error}
        onRefresh={onRefresh}
        onRetry={() => void refetch()}
        keyExtractor={(j) => j.id}
        header={
          <View style={{ gap: spacing.sm }}>
            <SearchInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search title, company, location"
            />
            <Tabs items={sourceTabs} value={source} onChange={setSource} />
          </View>
        }
        ItemSeparatorComponent={() => <Divider />}
        contentContainerStyle={{
          paddingHorizontal: spacing.lg,
          paddingTop: spacing.sm,
          paddingBottom: spacing['4xl'] + insets.bottom,
          flexGrow: 1,
        }}
        emptyTitle={query ? 'No matches' : 'No jobs yet'}
        emptyDescription={
          query
            ? 'Try a different search term.'
            : 'Jobs appear here once the ingestion job has run.'
        }
        renderItem={({ item }) => {
          const src = item.publisher ?? item.source;
          const host = item.apply_url ? displayHost(item.apply_url) : null;
          return (
            <Pressable
              onPress={() => router.push(`/(app)/job/${item.id}`)}
              style={({ pressed }) => ({
                opacity: pressed ? 0.6 : 1,
                paddingVertical: spacing.md,
              })}
            >
              <Text
                numberOfLines={2}
                style={{ fontSize: fontSize.md, fontWeight: '600', color: colors.ink }}
              >
                {item.title}
              </Text>
              <Text
                numberOfLines={1}
                style={{ fontSize: fontSize.sm, color: colors.muted, marginTop: 2 }}
              >
                {item.company_name ?? 'Company not listed'}
                {item.location ? ` · ${item.location}` : ''}
                {item.is_remote ? ' · Remote' : ''}
              </Text>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 6,
                  marginTop: 3,
                }}
              >
                {src ? (
                  <Text style={{ fontSize: fontSize.xs, fontWeight: '700', color: colors.ink2 }}>
                    {src}
                  </Text>
                ) : null}
                {item.employment_type ? (
                  <Text style={{ fontSize: fontSize.xs, color: colors.muted }}>
                    · {item.employment_type}
                  </Text>
                ) : null}
                {item.posted_at ? (
                  <Text style={{ fontSize: fontSize.xs, color: colors.faint }}>
                    · {relativeDate(item.posted_at)}
                  </Text>
                ) : null}
                {host ? (
                  <Text style={{ fontSize: fontSize.xs, color: colors.faint }}>· {host}</Text>
                ) : null}
              </View>
            </Pressable>
          );
        }}
      />
    </Screen>
  );
}
