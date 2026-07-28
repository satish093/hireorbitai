import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { ListScreen, PageHeader } from '../../src/components/ui/Screen';
import { Card } from '../../src/components/ui/Card';
import { Tabs, type TabItem } from '../../src/components/ui/Tabs';
import { Sheet, ConfirmSheet } from '../../src/components/ui/Sheet';
import { SelectInput } from '../../src/components/ui/Inputs';
import { Button } from '../../src/components/ui/Button';
import { Pill, APPLICATION_STATUS_TONE } from '../../src/components/ui/Pill';
import { RouteGuard } from '../../src/components/RouteGuard';
import { useApiList, useApiMutation } from '../../src/hooks/useApi';
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
 *
 * Operators can change a submission's status or delete it inline via a bottom
 * Sheet — the mobile equivalent of the web's manage-submission modal
 * (PATCH/DELETE /applications/:id, both OPERATOR_TIER-gated server-side).
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

const EDITABLE_STATUSES: ApplicationStatus[] = [
  'SUBMITTED',
  'SCREENING',
  'INTERVIEW',
  'OFFER',
  'REJECTED',
  'WITHDRAWN',
];

const titleCase = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

function ApplicationsList() {
  const { profile } = useAuth();
  const { colors, spacing, fontSize } = useTheme();
  const [status, setStatus] = useState<ApplicationStatus | 'ALL'>('ALL');
  const [editApp, setEditApp] = useState<Application | null>(null);
  const [draftStatus, setDraftStatus] = useState<ApplicationStatus>('SUBMITTED');
  const [confirmDelete, setConfirmDelete] = useState<Application | null>(null);

  const isConsultant = profile?.role === 'CONSULTANT';
  const endpoint = isConsultant ? '/applications/mine' : '/applications';

  const { items, loading, refreshing, error, onRefresh, refetch } = useApiList<Application>(
    endpoint,
    { channel: 'applications' },
  );

  const patchStatus = useApiMutation('patch', '/applications', { invalidates: ['applications'] });
  const removeApp = useApiMutation('delete', '/applications', { invalidates: ['applications'] });

  const counts = useMemo(() => {
    const map: Record<string, number> = { ALL: items.length };
    for (const a of items) map[a.status] = (map[a.status] ?? 0) + 1;
    return map;
  }, [items]);

  const tabs: TabItem[] = STATUS_FILTERS.map((s) => ({
    key: s,
    label: s === 'ALL' ? 'All' : titleCase(s),
    count: counts[s] ?? 0,
  }));

  const filtered = useMemo(
    () => (status === 'ALL' ? items : items.filter((a) => a.status === status)),
    [items, status],
  );

  const openEdit = (app: Application) => {
    setEditApp(app);
    setDraftStatus(app.status);
  };

  const saveStatus = async () => {
    if (!editApp) return;
    await patchStatus.mutate({ status: draftStatus }, `/applications/${editApp.id}`);
    setEditApp(null);
    void refetch();
  };

  const doDelete = async () => {
    if (!confirmDelete) return;
    await removeApp.mutate(undefined, `/applications/${confirmDelete.id}`);
    setConfirmDelete(null);
    void refetch();
  };

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
        header={<Tabs items={tabs} value={status} onChange={(k) => setStatus(k as never)} />}
        emptyTitle={status === 'ALL' ? 'No applications yet' : `Nothing ${status.toLowerCase()}`}
        emptyDescription={
          isConsultant
            ? 'Submissions your recruiter makes on your behalf appear here.'
            : 'Submit a consultant to a job to start the pipeline.'
        }
        renderItem={({ item }) => (
          <Card onPress={isConsultant ? undefined : () => openEdit(item)}>
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

      {/* Operator: manage a submission (status change + delete). */}
      <Sheet
        open={!!editApp}
        onClose={() => setEditApp(null)}
        title="Manage submission"
        footer={
          <View style={{ gap: spacing.sm }}>
            <Button label="Save" onPress={saveStatus} loading={patchStatus.pending} />
            <Button
              label="Delete submission"
              variant="danger-ghost"
              onPress={() => {
                const app = editApp;
                setEditApp(null);
                setConfirmDelete(app);
              }}
            />
          </View>
        }
      >
        <View style={{ gap: spacing.md }}>
          <Text style={{ fontSize: fontSize.md, fontWeight: '600', color: colors.ink }}>
            {editApp?.job?.title ?? 'Application'}
          </Text>
          {patchStatus.error ? (
            <Text style={{ color: colors.danger, fontSize: fontSize.sm }}>{patchStatus.error}</Text>
          ) : null}
          <SelectInput
            label="Status"
            value={draftStatus}
            onChange={(v) => setDraftStatus(v as ApplicationStatus)}
            options={EDITABLE_STATUSES.map((s) => ({ value: s, label: titleCase(s) }))}
          />
        </View>
      </Sheet>

      <ConfirmSheet
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={doDelete}
        title="Delete submission?"
        message="This removes the application from the pipeline. This cannot be undone."
        confirmLabel="Delete"
        destructive
      />
    </>
  );
}
