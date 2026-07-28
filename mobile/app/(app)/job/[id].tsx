import { Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { ScreenScroll, Banner } from '../../../src/components/ui/Screen';
import { Card, SectionHeader, DetailRow, Divider } from '../../../src/components/ui/Card';
import { Pill } from '../../../src/components/ui/Pill';
import { Button } from '../../../src/components/ui/Button';
import { SkeletonCard, ErrorState } from '../../../src/components/ui/States';
import { RouteGuard } from '../../../src/components/RouteGuard';
import { useApiQuery } from '../../../src/hooks/useApi';
import { OPERATOR_TIER, type Job } from '../../../src/types';
import { openExternalUrl, displayHost } from '../../../src/utils/safeUrl';
import { money } from '../../../src/utils/format';
import { useTheme } from '../../../src/theme';
import { relativeDate } from '../jobs';

/**
 * Job detail — GET /jobs/:id.
 *
 * OPERATOR_TIER, matching the router gate on /jobs.
 *
 * `apply_url` is ingested from a third-party board, so it is untrusted stored
 * data and goes through openExternalUrl (https-only). On a phone that matters
 * more than on the web: Linking.openURL hands the string to the OS, which will
 * resolve a custom scheme into another app.
 */
export default function JobDetailScreen() {
  return (
    <RouteGuard allow={[...OPERATOR_TIER]}>
      <JobDetail />
    </RouteGuard>
  );
}

function JobDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors, spacing, fontSize } = useTheme();

  const { data, loading, refreshing, error, onRefresh, refetch } = useApiQuery<Job>(
    id ? `/jobs/${id}` : null,
    { channel: 'jobs', enabled: !!id },
  );

  const salary = formatSalary(data?.salary_min, data?.salary_max);

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Job' }} />
      <ScreenScroll refreshing={refreshing} onRefresh={onRefresh} edges={[]}>
        {loading && !data ? (
          <SkeletonCard />
        ) : error && !data ? (
          <ErrorState message={error} onRetry={() => void refetch()} />
        ) : !data ? (
          <Banner tone="warn" message="This job is no longer available." />
        ) : (
          <>
            <Card>
              <Text style={{ fontSize: fontSize.xl, fontWeight: '700', color: colors.ink }}>
                {data.title}
              </Text>
              <Text style={{ fontSize: fontSize.md, color: colors.ink2, marginTop: 4 }}>
                {data.company_name ?? 'Company not listed'}
              </Text>
              <Text style={{ fontSize: fontSize.sm, color: colors.muted, marginTop: 2 }}>
                {data.location ?? 'Location not listed'}
                {data.is_remote ? ' · Remote' : ''}
              </Text>

              <View
                style={{
                  flexDirection: 'row',
                  flexWrap: 'wrap',
                  gap: 6,
                  marginTop: spacing.md,
                }}
              >
                {data.publisher || data.source ? (
                  <Pill label={data.publisher ?? data.source ?? ''} tone="neutral" size="sm" />
                ) : null}
                {data.employment_type ? (
                  <Pill label={data.employment_type} tone="info" size="sm" />
                ) : null}
                {salary ? <Pill label={salary} tone="success" size="sm" /> : null}
              </View>

              {data.apply_url ? (
                <View style={{ marginTop: spacing.lg }}>
                  <Button
                    label={
                      displayHost(data.apply_url)
                        ? `Apply on ${displayHost(data.apply_url)}`
                        : 'Open posting'
                    }
                    onPress={() => void openExternalUrl(data.apply_url)}
                  />
                </View>
              ) : null}
            </Card>

            <Card>
              <SectionHeader title="Details" />
              <DetailRow
                label="Posted"
                value={data.posted_at ? relativeDate(data.posted_at) : '—'}
              />
              <Divider />
              <DetailRow label="Added" value={relativeDate(data.created_at)} />
              <Divider />
              <DetailRow label="Source" value={data.publisher ?? data.source ?? '—'} />
            </Card>

            {data.skills?.length ? (
              <Card>
                <SectionHeader title="Skills" />
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {data.skills.map((s) => (
                    <Pill key={s} label={s} tone="brand" size="sm" />
                  ))}
                </View>
              </Card>
            ) : null}

            {data.description ? (
              <Card>
                <SectionHeader title="Description" />
                <Text style={{ fontSize: fontSize.base, color: colors.ink2, lineHeight: 22 }}>
                  {stripHtml(data.description)}
                </Text>
              </Card>
            ) : null}
          </>
        )}
      </ScreenScroll>
    </>
  );
}

function formatSalary(min?: number | null, max?: number | null): string | null {
  const fmt = (n: number) => money(n, 'USD');
  if (min && max) return `${fmt(min)} – ${fmt(max)}`;
  if (min) return `From ${fmt(min)}`;
  if (max) return `Up to ${fmt(max)}`;
  return null;
}

/**
 * Ingested descriptions are HTML from third-party boards. React Native's <Text>
 * renders no markup, so tags would show as literal angle brackets — strip them
 * and decode the handful of entities that actually appear.
 */
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
