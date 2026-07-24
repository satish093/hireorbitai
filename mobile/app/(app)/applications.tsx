import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { ListScreen, PageHeader } from '../../src/components/ui/Screen';
import { Card } from '../../src/components/ui/Card';
import { Pill, APPLICATION_STATUS_TONE } from '../../src/components/ui/Pill';
import { RouteGuard } from '../../src/components/RouteGuard';
import { useApiList } from '../../src/hooks/useApi';
import { useAuth } from '../../src/context/AuthContext';
import { BUSINESS_ROLES, type Application, type ApplicationStatus } from '../../src/types';
import { useTheme } from '../../src/theme';
import { relativeDate } from './jobs';

/**
 * Application pipeline.
 *
 * The endpoint depends on the caller's role, and that difference is load-bearing:
 *
 *   CONSULTANT → GET /applications/mine   self-scoped, NARROWED projection
 *   operator   → GET /applications        full recruiter-side context
 *
 * `/applications` responses carry the assigned recruiter, internal notes and ATS
 * scoring — data a consultant must not see. The mount is BUSINESS_ROLES only so
 * `/mine` is reachable; every operator route inside is separately OPERATOR_TIER
 * gated. Asking for the right one here is not just courtesy: calling
 * `/applications` as a consultant returns 403.
 */
export default function ApplicationsScreen() {
  return (
    <RouteGuard allow={[...BUSINESS_ROLES]}>
      <ApplicationsList />
    </RouteGuard>
  );
}

const STATUS_FILTERS: (ApplicationStatus | 'ALL')[] = [
  'ALL',
  'SUBMITTED',
  'SCREENING',
  'INTERVIEW',
  'OFFER',
  'REJECTED',
];

function ApplicationsList() {
  const { profile } = useAuth();
  const { colors, spacing, fontSize, radius } = useTheme();
  const [status, setStatus] = useState<ApplicationStatus | 'ALL'>('ALL');

  const isConsultant = profile?.role === 'CONSULTANT';
  const endpoint = isConsultant ? '/applications/mine' : '/applications';

  const { items, loading, refreshing, error, onRefresh, refetch } = useApiList<Application>(
    endpoint,
    { channel: 'applications' },
  );

  const filtered = useMemo(
    () => (status === 'ALL' ? items : items.filter((a) => a.status === status)),
    [items, status],
  );

  return (
    <>
      <PageHeader
        title="Applications"
        subtitle={isConsultant ? 'Your submissions' : `${items.length} total`}
      />
      <ListScreen
        items={filtered}
        loading={loading}
        refreshing={refreshing}
        error={error}
        onRefresh={onRefresh}
        onRetry={() => void refetch()}
        keyExtractor={(a) => a.id}
        header={
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: spacing.sm, paddingVertical: 2 }}
          >
            {STATUS_FILTERS.map((s) => {
              const active = s === status;
              return (
                <Pressable
                  key={s}
                  onPress={() => setStatus(s)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={{
                    paddingHorizontal: spacing.md,
                    // 44px minimum touch target.
                    height: 44,
                    justifyContent: 'center',
                    borderRadius: radius.pill,
                    backgroundColor: active ? colors.ink : colors.surface,
                    borderWidth: 1,
                    borderColor: active ? colors.ink : colors.border,
                  }}
                >
                  <Text
                    style={{
                      color: active ? colors.bg : colors.ink2,
                      fontSize: fontSize.sm,
                      fontWeight: '600',
                    }}
                  >
                    {s === 'ALL' ? 'All' : s.charAt(0) + s.slice(1).toLowerCase()}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        }
        emptyTitle={status === 'ALL' ? 'No applications yet' : `Nothing ${status.toLowerCase()}`}
        emptyDescription={
          isConsultant
            ? 'Submissions your recruiter makes on your behalf appear here.'
            : 'Submit a consultant to a job to start the pipeline.'
        }
        renderItem={({ item }) => (
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md }}>
              <View style={{ flex: 1 }}>
                <Text
                  numberOfLines={2}
                  style={{ fontSize: fontSize.md, fontWeight: '600', color: colors.ink }}
                >
                  {item.job?.title ?? 'Untitled role'}
                </Text>
                <Text
                  numberOfLines={1}
                  style={{ fontSize: fontSize.sm, color: colors.ink2, marginTop: 2 }}
                >
                  {item.job?.company_name ?? '—'}
                </Text>
                {/* Consultant name only renders on the operator response;
                    /applications/mine never includes it. */}
                {!isConsultant && item.consultant?.user?.full_name ? (
                  <Text
                    numberOfLines={1}
                    style={{ fontSize: fontSize.sm, color: colors.muted, marginTop: 2 }}
                  >
                    {item.consultant.user.full_name}
                  </Text>
                ) : null}
              </View>
              <Pill
                label={item.status}
                tone={APPLICATION_STATUS_TONE[item.status] ?? 'neutral'}
                size="sm"
              />
            </View>

            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.sm,
                marginTop: spacing.md,
              }}
            >
              <Text style={{ fontSize: fontSize.xs, color: colors.faint }}>
                {relativeDate(item.applied_at ?? item.created_at)}
              </Text>
              {!isConsultant && typeof item.ats_score === 'number' ? (
                <Pill
                  label={`ATS ${Math.round(item.ats_score)}`}
                  tone={item.ats_score >= 70 ? 'success' : item.ats_score >= 40 ? 'warn' : 'danger'}
                  size="sm"
                />
              ) : null}
            </View>
          </Card>
        )}
      />
    </>
  );
}
