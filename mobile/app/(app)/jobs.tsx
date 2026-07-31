import { useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Screen, ListScreen, Banner } from '../../src/components/ui/Screen';
import { PageTopBar } from '../../src/components/ui/TopBar';
import { Card } from '../../src/components/ui/Card';
import { Tabs, type TabItem } from '../../src/components/ui/Tabs';
import { SelectInput } from '../../src/components/ui/Inputs';
import { Button } from '../../src/components/ui/Button';
import { Avatar } from '../../src/components/ui/Avatar';
import { RouteGuard } from '../../src/components/RouteGuard';
import { useApiQuery, useApiMutation, useApiList } from '../../src/hooks/useApi';
import { useAuth } from '../../src/context/AuthContext';
import { OPERATOR_TIER, MANAGER_TIER, type Job, type Consultant } from '../../src/types';
import { useTheme } from '../../src/theme';
import { displayHost, openInAppBrowser } from '../../src/utils/safeUrl';
import { relativeDate } from '../../src/utils/format';
// Re-exported so the many screens that `import { relativeDate } from './jobs'`
// keep working. The implementation is Intl-free (see src/utils/format.ts).
export { relativeDate };

/**
 * Job search — the mobile port of the web JobSearch page. OPERATOR_TIER.
 *
 * Three feeds mirror the web tabs: Top → GET /jobs/recommended (semantic `q`
 * ranking + resume-aware match when a consultant is targeted), Saved →
 * /jobs/liked, Applied → /jobs/applied. Picking a consultant in the targeting
 * bar injects consultant_id + min_match=50 so rows carry match_score / matched /
 * missing skills. Manager-tier gets Sync + Enrich. Strict 4-source ingestion
 * (LinkedIn, Dice, Monster, CareerBuilder) — the source is shown on every row.
 */
export default function JobsScreen() {
  return (
    <RouteGuard allow={[...OPERATOR_TIER]}>
      <JobsList />
    </RouteGuard>
  );
}

const TABS: TabItem[] = [
  { key: 'recommended', label: 'Top' },
  { key: 'liked', label: 'Saved' },
  { key: 'applied', label: 'Applied' },
];

type JobFeed = { rows: Job[]; total: number };

/** /jobs/recommended returns {rows,total}; liked/applied return bare arrays. */
function normalizeFeed(raw: unknown): JobFeed {
  if (Array.isArray(raw)) return { rows: raw as Job[], total: raw.length };
  const env = raw as { rows?: Job[]; total?: number } | null;
  const rows = env?.rows ?? [];
  return { rows, total: env?.total ?? rows.length };
}

const jobSource = (j: Job) => j.source ?? j.publisher ?? 'Other';

/** Source → accent color for the "by source" pills. */
function sourceColor(src: string, colors: ReturnType<typeof useTheme>['colors']): string {
  const s = src.toLowerCase();
  if (s.includes('linkedin')) return colors.accent;
  if (s.includes('dice')) return colors.accent2;
  if (s.includes('monster')) return colors.warn;
  if (s.includes('careerbuilder')) return colors.success;
  return colors.faint;
}

function JobsList() {
  const { profile } = useAuth();
  const router = useRouter();
  const { colors, spacing, fontSize } = useTheme();
  const insets = useSafeAreaInsets();

  const isManager = !!profile && (MANAGER_TIER as readonly string[]).includes(profile.role);
  const canTarget = !!profile && profile.role !== 'CONSULTANT';

  const [tab, setTab] = useState<'recommended' | 'liked' | 'applied'>('recommended');
  const [queryInput, setQueryInput] = useState('');
  const [q, setQ] = useState('');
  const [consultantId, setConsultantId] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const endpoint =
    tab === 'recommended' ? '/jobs/recommended' : tab === 'liked' ? '/jobs/liked' : '/jobs/applied';

  const params = useMemo(() => {
    if (tab === 'recommended') {
      return {
        q: q || undefined,
        per_page: 40,
        ...(consultantId ? { consultant_id: consultantId, min_match: 50 } : {}),
      };
    }
    if (tab === 'applied' && consultantId) return { consultant_id: consultantId };
    return {};
  }, [tab, q, consultantId]);

  const feed = useApiQuery<JobFeed>(endpoint, {
    channel: 'jobs',
    params,
    select: normalizeFeed,
  });
  const rows = feed.data?.rows ?? [];
  const total = feed.data?.total ?? rows.length;

  const consultants = useApiList<Consultant>('/consultants', {
    channel: 'consultants',
    enabled: canTarget,
  });

  const sync = useApiMutation('post', '/jobs/sync', { invalidates: ['jobs'] });
  const enrich = useApiMutation('post', '/jobs/enrich-pending');
  const likeAdd = useApiMutation('post', '/jobs');
  const likeDel = useApiMutation('delete', '/jobs');

  const sourceCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const j of rows) m.set(jobSource(j), (m.get(jobSource(j)) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);

  const visible = useMemo(
    () => (sourceFilter ? rows.filter((j) => jobSource(j) === sourceFilter) : rows),
    [rows, sourceFilter],
  );

  const consultantOptions = [
    { value: '', label: '— Select consultant —' },
    ...consultants.items.map((c) => ({
      value: c.id,
      label: c.user?.full_name?.trim() || c.user?.email || 'Consultant',
    })),
  ];

  const toggleLike = (job: Job) => {
    const nowLiked = !job.liked;
    feed.setData((prev) => {
      const base = prev ?? { rows: [], total: 0 };
      return {
        ...base,
        rows: base.rows.map((r) => (r.id === job.id ? { ...r, liked: nowLiked } : r)),
      };
    });
    void (nowLiked ? likeAdd : likeDel).mutate(undefined, `/jobs/${job.id}/like`);
  };

  const runSync = async () => {
    setNotice(null);
    const r = await sync.mutate();
    if (r) {
      setNotice('Sync started — new jobs will appear shortly.');
      void feed.refetch();
    }
  };
  const runEnrich = async () => {
    setNotice(null);
    const r = await enrich.mutate();
    if (r) setNotice('Enriching pending jobs…');
  };

  return (
    <Screen edges={['top']}>
      <PageTopBar title="Jobs" subtitle={`${total.toLocaleString()} live openings`} />
      <ListScreen
        items={visible}
        loading={feed.loading}
        refreshing={feed.refreshing}
        error={feed.error}
        onRefresh={feed.onRefresh}
        onRetry={() => void feed.refetch()}
        keyExtractor={(j) => j.id}
        contentContainerStyle={{
          paddingHorizontal: spacing.lg,
          paddingTop: spacing.sm,
          paddingBottom: spacing['4xl'] + insets.bottom,
          flexGrow: 1,
        }}
        header={
          <View style={{ gap: spacing.md, marginBottom: spacing.sm }}>
            {/* AI search box */}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 12,
                paddingHorizontal: 12,
                height: 48,
                backgroundColor: colors.surface,
              }}
            >
              <View
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 8,
                  backgroundColor: colors.accent,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text style={{ color: '#fff', fontSize: 16 }}>✦</Text>
              </View>
              <TextInput
                style={{ flex: 1, fontSize: 16, color: colors.ink, padding: 0 }}
                placeholder="Describe your ideal role…"
                placeholderTextColor={colors.faint}
                value={queryInput}
                onChangeText={setQueryInput}
                returnKeyType="search"
                onSubmitEditing={() => {
                  setTab('recommended');
                  setQ(queryInput.trim());
                }}
              />
              {queryInput ? (
                <Pressable
                  onPress={() => {
                    setQueryInput('');
                    setQ('');
                  }}
                  hitSlop={8}
                >
                  <Text style={{ color: colors.faint, fontSize: 18 }}>×</Text>
                </Pressable>
              ) : null}
            </View>

            {isManager ? (
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <Button
                    label={sync.pending ? 'Syncing…' : 'Sync now'}
                    variant="secondary"
                    size="sm"
                    loading={sync.pending}
                    onPress={runSync}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Button
                    label={enrich.pending ? 'Enriching…' : '✦ Enrich'}
                    variant="secondary"
                    size="sm"
                    loading={enrich.pending}
                    onPress={runEnrich}
                  />
                </View>
              </View>
            ) : null}

            {/* Apply on behalf of */}
            {canTarget ? (
              <View
                style={{
                  borderWidth: 1,
                  borderColor: colors.brandSoftBorder ?? colors.border,
                  backgroundColor: colors.accentSoft,
                  borderRadius: 12,
                  padding: spacing.md,
                  gap: 6,
                }}
              >
                <Text
                  style={{
                    fontSize: fontSize.xs,
                    fontWeight: '800',
                    color: colors.accent,
                    letterSpacing: 0.5,
                  }}
                >
                  APPLY ON BEHALF OF
                </Text>
                <SelectInput
                  value={consultantId || ''}
                  options={consultantOptions}
                  onChange={setConsultantId}
                  placeholder="— Select consultant —"
                />
              </View>
            ) : null}

            <Tabs items={TABS} value={tab} onChange={(k) => setTab(k as typeof tab)} />

            {notice ? <Banner tone="info" message={notice} /> : null}
            {sync.error ? <Banner tone="danger" message={sync.error} /> : null}

            {canTarget && !consultantId && tab === 'recommended' ? (
              <Banner
                tone="info"
                message="Pick a consultant in the targeting bar to see resume-aware match scores."
              />
            ) : null}

            {/* By source */}
            {sourceCounts.length > 0 ? (
              <View
                style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}
              >
                <Text style={{ fontSize: fontSize.xs, fontWeight: '800', color: colors.muted }}>
                  BY SOURCE
                </Text>
                {sourceCounts.map(([src, count]) => {
                  const active = sourceFilter === src;
                  const c = sourceColor(src, colors);
                  return (
                    <Pressable
                      key={src}
                      onPress={() => setSourceFilter(active ? '' : src)}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 6,
                        paddingHorizontal: 10,
                        paddingVertical: 5,
                        borderRadius: 999,
                        borderWidth: 1,
                        borderColor: active ? c : colors.border,
                        backgroundColor: active ? c + '22' : 'transparent',
                      }}
                    >
                      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: c }} />
                      <Text style={{ fontSize: fontSize.sm, color: colors.ink, fontWeight: '600' }}>
                        {src}
                      </Text>
                      <Text style={{ fontSize: fontSize.sm, color: colors.muted }}>{count}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}

            <Text style={{ fontSize: fontSize.sm, color: colors.muted }}>
              Showing {visible.length} of {total.toLocaleString()} jobs
            </Text>
          </View>
        }
        emptyTitle={q ? 'No matches' : tab === 'liked' ? 'Nothing saved' : 'No jobs yet'}
        emptyDescription={
          tab === 'applied'
            ? 'Jobs you apply to appear here.'
            : tab === 'liked'
              ? 'Bookmark a job to save it for later.'
              : q
                ? 'Try describing the role differently.'
                : 'Jobs appear here once the ingestion job has run.'
        }
        renderItem={({ item }) => (
          <JobCard
            job={item}
            onToggleLike={() => toggleLike(item)}
            onOpen={() => router.push(`/(app)/job/${item.id}`)}
          />
        )}
      />
    </Screen>
  );
}

function JobCard({
  job,
  onToggleLike,
  onOpen,
}: {
  job: Job;
  onToggleLike: () => void;
  onOpen: () => void;
}) {
  const { colors, spacing, fontSize } = useTheme();

  const matched = job.match_matched_skills ?? [];
  const missing = job.match_missing_skills ?? [];
  const host = job.apply_url ? displayHost(job.apply_url) : null;
  const salary =
    job.salary_min || job.salary_max
      ? `$${Math.round((job.salary_min ?? job.salary_max ?? 0) / 1000)}k${
          job.salary_max && job.salary_min ? `–$${Math.round(job.salary_max / 1000)}k` : ''
        }`
      : null;

  return (
    <Card style={{ marginBottom: spacing.md }} onPress={onOpen}>
      <View style={{ flexDirection: 'row', gap: spacing.md }}>
        <Avatar id={job.id} name={job.company_name ?? job.title} size={40} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            numberOfLines={2}
            style={{ fontSize: fontSize.md, fontWeight: '700', color: colors.ink }}
          >
            {job.title}
          </Text>
          <Text
            numberOfLines={1}
            style={{ fontSize: fontSize.sm, color: colors.muted, marginTop: 2 }}
          >
            {job.company_name ?? 'Company not listed'}
            {job.location ? ` · ${job.location}` : ''}
            {job.is_remote ? ' · Remote' : ''}
          </Text>
        </View>
        {typeof job.match_score === 'number' ? (
          <View
            style={{
              paddingHorizontal: 8,
              height: 24,
              borderRadius: 999,
              backgroundColor: colors.successSoft,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ fontSize: fontSize.xs, fontWeight: '800', color: colors.success }}>
              {Math.round(job.match_score)}% match
            </Text>
          </View>
        ) : null}
      </View>

      {/* tags */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.sm }}>
        {job.seniority ? <Tag label={job.seniority} /> : null}
        {job.employment_type ? <Tag label={job.employment_type} /> : null}
        {salary ? <Tag label={salary} /> : null}
        {job.source || job.publisher ? <Tag label={jobSource(job)} tone="brand" /> : null}
      </View>

      {job.match_why ? (
        <Text style={{ fontSize: fontSize.sm, color: colors.ink2, marginTop: spacing.sm }}>
          ✦ {job.match_why}
        </Text>
      ) : null}

      {/* skill match chips */}
      {matched.length || missing.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.sm }}>
          {matched.slice(0, 4).map((s) => (
            <View
              key={`m-${s}`}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                paddingHorizontal: 8,
                paddingVertical: 3,
                borderRadius: 999,
                backgroundColor: colors.successSoft,
              }}
            >
              <Text style={{ fontSize: fontSize.xs, color: colors.success, fontWeight: '700' }}>
                ✓ {s}
              </Text>
            </View>
          ))}
          {missing.slice(0, 3).map((s) => (
            <View
              key={`x-${s}`}
              style={{
                paddingHorizontal: 8,
                paddingVertical: 3,
                borderRadius: 999,
                backgroundColor: colors.bgSunken ?? colors.hover,
              }}
            >
              <Text style={{ fontSize: fontSize.xs, color: colors.muted }}>{s}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {/* footer */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
          marginTop: spacing.md,
        }}
      >
        <Text style={{ fontSize: fontSize.xs, color: colors.faint, flex: 1 }}>
          {job.posted_at ? relativeDate(job.posted_at) : ''}
          {host ? ` · ${host}` : ''}
        </Text>
        <Pressable
          onPress={onToggleLike}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={job.liked ? 'Unsave job' : 'Save job'}
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: colors.border,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ fontSize: 16, color: job.liked ? colors.accent : colors.muted }}>
            {job.liked ? '★' : '☆'}
          </Text>
        </Pressable>
        {job.apply_url ? (
          <Button
            label="Apply"
            variant="accent"
            size="sm"
            block={false}
            onPress={() => openInAppBrowser(job.apply_url!)}
          />
        ) : null}
      </View>
    </Card>
  );
}

function Tag({ label, tone }: { label: string; tone?: 'brand' }) {
  const { colors, fontSize } = useTheme();
  return (
    <View
      style={{
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 999,
        backgroundColor: tone === 'brand' ? (colors.brandSoft ?? colors.hover) : colors.hover,
      }}
    >
      <Text
        style={{
          fontSize: fontSize.xs,
          fontWeight: '600',
          color: tone === 'brand' ? colors.accent : colors.ink2,
        }}
      >
        {label}
      </Text>
    </View>
  );
}
