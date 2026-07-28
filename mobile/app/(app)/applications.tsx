import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Screen, ListScreen } from '../../src/components/ui/Screen';
import { PageTopBar } from '../../src/components/ui/TopBar';
import { Divider } from '../../src/components/ui/Card';
import { Tabs, type TabItem } from '../../src/components/ui/Tabs';
import { Sheet, ConfirmSheet } from '../../src/components/ui/Sheet';
import { SelectInput } from '../../src/components/ui/Inputs';
import { Button } from '../../src/components/ui/Button';
import { Avatar } from '../../src/components/ui/Avatar';
import { APPLICATION_STATUS_TONE, pillToneColor } from '../../src/components/ui/Pill';
import { RouteGuard } from '../../src/components/RouteGuard';
import { useApiList, useApiMutation } from '../../src/hooks/useApi';
import { useAuth } from '../../src/context/AuthContext';
import { BUSINESS_ROLES, type Application, type ApplicationStatus } from '../../src/types';
import { useTheme } from '../../src/theme';
import { relativeDate } from './jobs';

/**
 * Application pipeline. The endpoint depends on the caller's role, and that
 * difference is load-bearing (see the original header): a CONSULTANT hits
 * /applications/mine (narrowed projection); an operator hits /applications
 * (full recruiter-side context). Operators can change status / delete inline
 * via the bottom Sheet.
 *
 * Rows follow the web's compact pattern: consultant avatar, the primary name,
 * a role · company line, then an inline coloured status dot + relative time.
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
  const insets = useSafeAreaInsets();
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
    <Screen edges={['top']}>
      <PageTopBar
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
        ItemSeparatorComponent={() => <Divider />}
        contentContainerStyle={{
          paddingHorizontal: spacing.lg,
          paddingTop: spacing.sm,
          paddingBottom: spacing['4xl'] + insets.bottom,
          flexGrow: 1,
        }}
        emptyTitle={status === 'ALL' ? 'No applications yet' : `Nothing ${status.toLowerCase()}`}
        emptyDescription={
          isConsultant
            ? 'Submissions your recruiter makes on your behalf appear here.'
            : 'Submit a consultant to a job to start the pipeline.'
        }
        renderItem={({ item }) => {
          const statusColor = pillToneColor(
            APPLICATION_STATUS_TONE[item.status] ?? 'neutral',
            colors,
          );
          const name = item.consultant?.user?.full_name;
          const jobTitle = item.job?.title ?? 'Untitled role';
          const company = item.job?.company_name;
          const primary = isConsultant ? jobTitle : (name ?? jobTitle);
          const secondary = isConsultant
            ? (company ?? '—')
            : `${jobTitle}${company ? ` · ${company}` : ''}`;
          return (
            <Pressable
              onPress={isConsultant ? undefined : () => openEdit(item)}
              style={({ pressed }) => ({
                opacity: pressed ? 0.6 : 1,
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.md,
                paddingVertical: spacing.md,
              })}
            >
              {!isConsultant ? (
                <Avatar
                  id={item.consultant?.id}
                  name={name}
                  email={item.consultant?.user?.email}
                  size={38}
                />
              ) : null}

              <View style={{ flex: 1 }}>
                <Text
                  numberOfLines={1}
                  style={{ fontSize: fontSize.md, fontWeight: '600', color: colors.ink }}
                >
                  {primary}
                </Text>
                <Text numberOfLines={1} style={{ fontSize: fontSize.sm, color: colors.muted }}>
                  {secondary}
                </Text>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 6,
                    marginTop: 3,
                    flexWrap: 'wrap',
                  }}
                >
                  <View
                    style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: statusColor }}
                  />
                  <Text style={{ fontSize: fontSize.sm, color: statusColor, fontWeight: '600' }}>
                    {titleCase(item.status)}
                  </Text>
                  <Text style={{ fontSize: fontSize.xs, color: colors.faint }}>
                    · {relativeDate(item.applied_at ?? item.created_at)}
                  </Text>
                  {!isConsultant && typeof item.ats_score === 'number' ? (
                    <Text
                      style={{
                        fontSize: fontSize.xs,
                        fontWeight: '600',
                        color:
                          item.ats_score >= 70
                            ? colors.success
                            : item.ats_score >= 40
                              ? colors.warn
                              : colors.danger,
                      }}
                    >
                      · ATS {Math.round(item.ats_score)}
                    </Text>
                  ) : null}
                </View>
              </View>
            </Pressable>
          );
        }}
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
    </Screen>
  );
}
