import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ListScreen, PageHeader } from '../../src/components/ui/Screen';
import { Card } from '../../src/components/ui/Card';
import { Pill } from '../../src/components/ui/Pill';
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
 * Job search.
 *
 * OPERATOR_TIER only — the /jobs router is gated that way server-side, so a
 * CONSULTANT never reaches this screen (and the nav model already hides it).
 *
 * Ingestion is a strict 4-source policy: LinkedIn, Dice, Monster and
 * CareerBuilder. Anything else appearing in `source`/`publisher` would mean the
 * JSEARCH_ALLOWED publisher filter has been bypassed — worth noticing, so the
 * source is shown on every row rather than hidden.
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
  const [query, setQuery] = useState('');
  const [source, setSource] = useState<string>('ALL');

  const { items, loading, refreshing, error, onRefresh, refetch } = useApiList<Job>('/jobs', {
    channel: 'jobs',
  });

  // Filter locally. The list endpoint supports server-side search, but a phone
  // keystroke-per-request would burn the rate limit; the visible page is small
  // enough that client filtering is instant and free.
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
    <>
      <PageHeader title="Jobs" subtitle={`${items.length} in your feed`} />
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
        emptyTitle={query ? 'No matches' : 'No jobs yet'}
        emptyDescription={
          query
            ? 'Try a different search term.'
            : 'Jobs appear here once the ingestion job has run.'
        }
        renderItem={({ item }) => (
          <Card onPress={() => router.push(`/(app)/job/${item.id}`)}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md }}>
              <View style={{ flex: 1 }}>
                <Text
                  numberOfLines={2}
                  style={{ fontSize: fontSize.md, fontWeight: '600', color: colors.ink }}
                >
                  {item.title}
                </Text>
                <Text
                  numberOfLines={1}
                  style={{ fontSize: fontSize.sm, color: colors.ink2, marginTop: 2 }}
                >
                  {item.company_name ?? 'Company not listed'}
                </Text>
                <Text
                  numberOfLines={1}
                  style={{ fontSize: fontSize.sm, color: colors.muted, marginTop: 2 }}
                >
                  {item.location ?? 'Location not listed'}
                  {item.is_remote ? ' · Remote' : ''}
                </Text>
              </View>
            </View>

            <View
              style={{
                flexDirection: 'row',
                flexWrap: 'wrap',
                gap: 6,
                marginTop: spacing.md,
                alignItems: 'center',
              }}
            >
              {item.publisher || item.source ? (
                <Pill label={item.publisher ?? item.source ?? ''} tone="neutral" size="sm" />
              ) : null}
              {item.employment_type ? (
                <Pill label={item.employment_type} tone="info" size="sm" />
              ) : null}
              {item.posted_at ? (
                <Text style={{ fontSize: fontSize.xs, color: colors.faint }}>
                  {relativeDate(item.posted_at)}
                </Text>
              ) : null}
              {item.apply_url && displayHost(item.apply_url) ? (
                <Text style={{ fontSize: fontSize.xs, color: colors.faint }}>
                  · {displayHost(item.apply_url)}
                </Text>
              ) : null}
            </View>
          </Card>
        )}
      />
    </>
  );
}
