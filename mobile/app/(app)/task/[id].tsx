import { useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Screen, Banner } from '../../../src/components/ui/Screen';
import { PageTopBar } from '../../../src/components/ui/TopBar';
import { Card, SectionHeader, DetailRow, Divider } from '../../../src/components/ui/Card';
import { Pill, TASK_STATUS_TONE, TASK_PRIORITY_TONE } from '../../../src/components/ui/Pill';
import { Button } from '../../../src/components/ui/Button';
import { Avatar } from '../../../src/components/ui/Avatar';
import { SelectInput } from '../../../src/components/ui/Inputs';
import { FormInput } from '../../../src/components/ui/Inputs';
import { SkeletonCard, ErrorState, EmptyState } from '../../../src/components/ui/States';
import { RouteGuard } from '../../../src/components/RouteGuard';
import { useApiQuery, useApiList, useApiMutation } from '../../../src/hooks/useApi';
import {
  BUSINESS_ROLES,
  TASK_STATUSES,
  TASK_STATUS_LABEL,
  type Task,
  type TaskComment,
  type TaskStatus,
} from '../../../src/types';
import { useTheme } from '../../../src/theme';
import { relativeDate } from '../jobs';

/**
 * Task detail — GET /tasks/:id, with status change and comments.
 *
 * Status uses the dedicated PATCH /tasks/:id/status endpoint (not a general
 * PATCH with a status field) so a transition is never a general-purpose row
 * update. Uses the site-style PageTopBar (back + bell + toggle) rather than the
 * native Stack header.
 */
export default function TaskDetailScreen() {
  return (
    <RouteGuard allow={[...BUSINESS_ROLES]} feature="tasks">
      <TaskDetail />
    </RouteGuard>
  );
}

function TaskDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors, spacing, fontSize } = useTheme();
  const insets = useSafeAreaInsets();
  const [comment, setComment] = useState('');

  const task = useApiQuery<Task>(id ? `/tasks/${id}` : null, {
    channel: 'tasks',
    enabled: !!id,
  });

  const comments = useApiList<TaskComment>(id ? `/tasks/${id}/comments` : null, {
    channel: 'tasks',
    enabled: !!id,
  });

  const setStatus = useApiMutation<{ status: TaskStatus }, Task>('patch', `/tasks/${id}/status`, {
    invalidates: ['tasks'],
    onSuccess: (updated) => task.setData(updated),
  });

  const addComment = useApiMutation<{ body: string }, TaskComment>(
    'post',
    `/tasks/${id}/comments`,
    { invalidates: ['tasks'] },
  );

  const submitComment = async () => {
    const body = comment.trim();
    if (!body) return;
    const created = await addComment.mutate({ body });
    if (created) {
      setComment('');
      void comments.refetch();
    }
  };

  const t = task.data;

  return (
    <Screen edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <PageTopBar showBack title="Task" />
      <ScrollView
        contentContainerStyle={{
          padding: spacing.lg,
          paddingBottom: spacing['4xl'] + insets.bottom,
          gap: spacing.lg,
        }}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={!!task.refreshing}
            onRefresh={task.onRefresh}
            tintColor={colors.accent}
            colors={[colors.accent]}
          />
        }
      >
        {task.loading && !t ? (
          <SkeletonCard />
        ) : task.error && !t ? (
          <ErrorState message={task.error} onRetry={() => void task.refetch()} />
        ) : !t ? (
          <Banner tone="warn" message="This task is no longer available." />
        ) : (
          <>
            <Card>
              <Text style={{ fontSize: fontSize.lg, fontWeight: '700', color: colors.ink }}>
                {t.title}
              </Text>
              {t.description ? (
                <Text
                  style={{
                    fontSize: fontSize.base,
                    color: colors.ink2,
                    lineHeight: 22,
                    marginTop: spacing.sm,
                  }}
                >
                  {t.description}
                </Text>
              ) : null}

              <View
                style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.md }}
              >
                <Pill
                  label={TASK_STATUS_LABEL[t.status] ?? t.status}
                  tone={TASK_STATUS_TONE[t.status] ?? 'neutral'}
                  size="sm"
                />
                {t.priority ? (
                  <Pill
                    label={t.priority}
                    tone={TASK_PRIORITY_TONE[t.priority] ?? 'neutral'}
                    size="sm"
                  />
                ) : null}
                {t.tags?.map((tag) => (
                  <Pill key={tag} label={tag} tone="brand" size="sm" />
                ))}
              </View>
            </Card>

            <Card>
              <SectionHeader title="Status" />
              <SelectInput
                label={undefined}
                value={t.status}
                options={TASK_STATUSES.map((s) => ({
                  value: s,
                  label: TASK_STATUS_LABEL[s] ?? s,
                }))}
                onChange={(next) => void setStatus.mutate({ status: next as TaskStatus })}
                disabled={setStatus.pending}
              />
              {setStatus.error ? <Banner tone="danger" message={setStatus.error} /> : null}
            </Card>

            <Card>
              <SectionHeader title="Details" />
              <DetailRow
                label="Assignee"
                value={
                  t.assignee ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Avatar
                        id={t.assignee.id}
                        name={t.assignee.full_name}
                        email={t.assignee.email}
                        size={24}
                      />
                      <Text style={{ color: colors.ink, fontSize: fontSize.base }}>
                        {t.assignee.full_name ?? t.assignee.email}
                      </Text>
                    </View>
                  ) : undefined
                }
              />
              <Divider />
              <DetailRow
                label="Due"
                value={t.due_at ? new Date(t.due_at).toLocaleDateString() : '—'}
              />
              <Divider />
              <DetailRow label="Created" value={relativeDate(t.created_at)} />
              {t.creator ? (
                <>
                  <Divider />
                  <DetailRow label="Created by" value={t.creator.full_name ?? t.creator.email} />
                </>
              ) : null}
            </Card>

            <Card>
              <SectionHeader
                title={`Comments${comments.items.length ? ` (${comments.items.length})` : ''}`}
              />

              {comments.loading ? (
                <SkeletonCard />
              ) : comments.items.length === 0 ? (
                <EmptyState compact title="No comments yet" />
              ) : (
                comments.items.map((c, i) => (
                  <View key={c.id}>
                    {i > 0 ? <Divider /> : null}
                    <View style={{ flexDirection: 'row', gap: spacing.md, paddingVertical: 10 }}>
                      <Avatar
                        id={c.author?.id}
                        name={c.author?.full_name}
                        email={c.author?.email}
                        size={32}
                      />
                      <View style={{ flex: 1 }}>
                        <View
                          style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}
                        >
                          <Text
                            numberOfLines={1}
                            style={{
                              flex: 1,
                              fontSize: fontSize.sm,
                              fontWeight: '600',
                              color: colors.ink,
                            }}
                          >
                            {c.author?.full_name ?? c.author?.email ?? 'Someone'}
                          </Text>
                          <Text style={{ fontSize: fontSize.xs, color: colors.faint }}>
                            {relativeDate(c.created_at)}
                          </Text>
                        </View>
                        <Text
                          style={{
                            fontSize: fontSize.base,
                            color: colors.ink2,
                            marginTop: 2,
                            lineHeight: 20,
                          }}
                        >
                          {c.body}
                        </Text>
                      </View>
                    </View>
                  </View>
                ))
              )}

              <View style={{ marginTop: spacing.md }}>
                <FormInput
                  value={comment}
                  onChangeText={setComment}
                  placeholder="Add a comment…"
                  multiline
                />
                {addComment.error ? <Banner tone="danger" message={addComment.error} /> : null}
                <Button
                  label="Post comment"
                  onPress={submitComment}
                  disabled={!comment.trim() || addComment.pending}
                  loading={addComment.pending}
                  variant="secondary"
                />
              </View>
            </Card>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
