import { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Screen, ListScreen } from '../../src/components/ui/Screen';
import { PageTopBar } from '../../src/components/ui/TopBar';
import { Divider } from '../../src/components/ui/Card';
import { Tabs, type TabItem } from '../../src/components/ui/Tabs';
import { Sheet } from '../../src/components/ui/Sheet';
import { Button } from '../../src/components/ui/Button';
import { FormInput, SelectInput } from '../../src/components/ui/Inputs';
import { RouteGuard } from '../../src/components/RouteGuard';
import { useApiList, useApiMutation } from '../../src/hooks/useApi';
import { useAuth } from '../../src/context/AuthContext';
import {
  BUSINESS_ROLES,
  TASK_PRIORITIES,
  TASK_STATUS_LABEL,
  isManagerOrUp,
  type Task,
  type TaskStatus,
  type TaskPriority,
  type UserRef,
} from '../../src/types';
import { useTheme, type Palette } from '../../src/theme';

/**
 * Task list — the mobile port of the web board/table (neither survives a phone
 * screen, so it's a filtered list with the same data + actions).
 *
 * The web's mobile task list is a stack of compact borderless rows: a round
 * checkbox (filled green when done), the title (strikethrough when complete), a
 * coloured status line (red "Overdue · date"), and a muted note. This mirrors
 * that. Due-date urgency is computed against the reader's clock, not the server's.
 */
export default function TasksScreen() {
  return (
    <RouteGuard allow={[...BUSINESS_ROLES]} feature="tasks">
      <TaskList />
    </RouteGuard>
  );
}

const STATUS_FILTERS: (TaskStatus | 'ALL' | 'OPEN')[] = [
  'OPEN',
  'ALL',
  'TODO',
  'IN_PROGRESS',
  'BLOCKED',
  'REVIEW',
  'COMPLETED',
];

const DONE_STATUSES: TaskStatus[] = ['COMPLETED', 'CANCELLED'];

function TaskList() {
  const router = useRouter();
  const { profile } = useAuth();
  const { colors, spacing, fontSize } = useTheme();
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState<TaskStatus | 'ALL' | 'OPEN'>('OPEN');

  // Only MANAGER_TIER may create (POST /tasks is role-gated); mirror that here so
  // the affordance never attaches for a recruiter/consultant who'd get a 403.
  const canCreate = isManagerOrUp(profile?.role);
  const [createOpen, setCreateOpen] = useState(false);

  // The dashboard's "+ New task" button deep-links here with ?new=1.
  const params = useLocalSearchParams<{ new?: string }>();
  useEffect(() => {
    if (params.new === '1' && canCreate) setCreateOpen(true);
  }, [params.new, canCreate]);

  const { items, loading, refreshing, error, onRefresh, refetch } = useApiList<Task>('/tasks', {
    channel: 'tasks',
  });

  // Status-only toggle from the row checkbox. urlOverride carries the row id, so
  // one mutation serves every row. invalidates:['tasks'] refetches this list.
  const toggleStatus = useApiMutation<{ status: TaskStatus }, Task>('patch', '/tasks', {
    invalidates: ['tasks'],
  });
  const toggleDone = (t: Task) => {
    const next: TaskStatus = DONE_STATUSES.includes(t.status) ? 'TODO' : 'COMPLETED';
    void toggleStatus.mutate({ status: next }, `/tasks/${t.id}/status`);
  };

  const filtered = useMemo(() => {
    if (filter === 'ALL') return items;
    if (filter === 'OPEN') return items.filter((t) => !DONE_STATUSES.includes(t.status));
    return items.filter((t) => t.status === filter);
  }, [items, filter]);

  const counts = useMemo(() => {
    const open = items.filter((t) => !DONE_STATUSES.includes(t.status)).length;
    const map: Record<string, number> = { ALL: items.length, OPEN: open };
    for (const t of items) map[t.status] = (map[t.status] ?? 0) + 1;
    return map;
  }, [items]);

  const tabs: TabItem[] = STATUS_FILTERS.map((s) => ({
    key: s,
    label: s === 'ALL' ? 'All' : s === 'OPEN' ? 'Open' : (TASK_STATUS_LABEL[s as TaskStatus] ?? s),
    count: counts[s] ?? 0,
  }));

  return (
    <Screen edges={['top']}>
      <PageTopBar
        title="Tasks"
        subtitle={`${items.length} total`}
        right={
          canCreate ? (
            <Pressable
              onPress={() => setCreateOpen(true)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="New task"
              style={{ height: 36, paddingHorizontal: spacing.sm, justifyContent: 'center' }}
            >
              <Text style={{ color: colors.accent, fontSize: fontSize.md, fontWeight: '700' }}>
                + New
              </Text>
            </Pressable>
          ) : null
        }
      />
      <ListScreen
        items={filtered}
        loading={loading}
        refreshing={refreshing}
        error={error}
        onRefresh={onRefresh}
        onRetry={() => void refetch()}
        keyExtractor={(t) => t.id}
        header={<Tabs items={tabs} value={filter} onChange={(k) => setFilter(k as never)} />}
        ItemSeparatorComponent={() => <Divider />}
        contentContainerStyle={{
          paddingHorizontal: spacing.lg,
          paddingTop: spacing.sm,
          paddingBottom: spacing['4xl'] + insets.bottom,
          flexGrow: 1,
        }}
        emptyTitle={filter === 'OPEN' ? 'Nothing open' : 'No tasks'}
        emptyDescription="Tasks assigned to you or your team will show up here."
        renderItem={({ item }) => {
          const done = DONE_STATUSES.includes(item.status);
          const line = statusLine(item.due_at, item.status, colors);
          return (
            <Pressable
              onPress={() => router.push(`/(app)/task/${item.id}`)}
              style={({ pressed }) => ({
                opacity: pressed ? 0.6 : 1,
                flexDirection: 'row',
                alignItems: 'flex-start',
                gap: spacing.md,
                paddingVertical: spacing.md,
              })}
            >
              {/* Nested Pressable: tapping the checkbox toggles COMPLETED and does
                  NOT bubble to the row's navigate handler. */}
              <Pressable
                onPress={() => toggleDone(item)}
                hitSlop={10}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: done }}
                accessibilityLabel={done ? 'Mark task incomplete' : 'Mark task complete'}
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 11,
                  marginTop: 1,
                  borderWidth: 1.5,
                  borderColor: done ? colors.success : colors.borderStrong,
                  backgroundColor: done ? colors.success : 'transparent',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {done ? (
                  <Text style={{ color: '#ffffff', fontSize: 12, fontWeight: '800' }}>✓</Text>
                ) : null}
              </Pressable>

              <View style={{ flex: 1 }}>
                <Text
                  numberOfLines={2}
                  style={{
                    fontSize: fontSize.md,
                    fontWeight: '600',
                    color: done ? colors.muted : colors.ink,
                    textDecorationLine: done ? 'line-through' : 'none',
                  }}
                >
                  {item.title}
                </Text>

                {line ? (
                  <View
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 }}
                  >
                    <View
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: 3.5,
                        backgroundColor: line.color,
                      }}
                    />
                    <Text style={{ fontSize: fontSize.sm, color: line.color, fontWeight: '600' }}>
                      {line.text}
                    </Text>
                  </View>
                ) : null}

                {item.description ? (
                  <Text
                    numberOfLines={1}
                    style={{ fontSize: fontSize.sm, color: colors.muted, marginTop: 2 }}
                  >
                    {item.description}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          );
        }}
      />

      {canCreate ? <NewTaskSheet open={createOpen} onClose={() => setCreateOpen(false)} /> : null}
    </Screen>
  );
}

/** Assignee shape returned by GET /tasks/assignees (lean picker projection). */
type Assignee = Pick<UserRef, 'id' | 'full_name' | 'email' | 'role'>;

/**
 * Manager create-task sheet — mirrors the web CreateTaskModal's everyday path:
 * title (required), description, priority, optional assignee. POST /tasks is
 * MANAGER_TIER-gated, matching canCreate at the call site.
 */
function NewTaskSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { colors, spacing, fontSize } = useTheme();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('MEDIUM');
  const [assigneeId, setAssigneeId] = useState<string>('');

  // Only fetch the assignee list while the sheet is open (manager-only endpoint).
  const assignees = useApiList<Assignee>(open ? '/tasks/assignees' : null, {
    channel: 'tasks',
    enabled: open,
  });

  const create = useApiMutation<
    {
      title: string;
      description: string | null;
      priority: TaskPriority;
      assignee_id: string | null;
    },
    Task
  >('post', '/tasks', { invalidates: ['tasks'] });

  const reset = () => {
    setTitle('');
    setDescription('');
    setPriority('MEDIUM');
    setAssigneeId('');
    create.reset();
  };

  const close = () => {
    reset();
    onClose();
  };

  const submit = async () => {
    const t = title.trim();
    if (!t) return;
    const created = await create.mutate({
      title: t,
      description: description.trim() || null,
      priority,
      assignee_id: assigneeId || null,
    });
    if (created) close();
  };

  const assigneeOptions = [
    { value: '', label: 'Unassigned' },
    ...assignees.items.map((a) => ({ value: a.id, label: a.full_name ?? a.email })),
  ];

  return (
    <Sheet
      open={open}
      onClose={close}
      title="New task"
      footer={
        <Button
          label="Create task"
          onPress={submit}
          disabled={!title.trim() || create.pending}
          loading={create.pending}
        />
      }
    >
      <View>
        <FormInput
          label="Title"
          value={title}
          onChangeText={setTitle}
          placeholder="What needs doing?"
          required
        />
        <FormInput
          label="Description"
          value={description}
          onChangeText={setDescription}
          placeholder="Add context (optional)"
          multiline
        />
        <SelectInput
          label="Priority"
          value={priority}
          onChange={(v) => setPriority(v as TaskPriority)}
          options={TASK_PRIORITIES.map((p) => ({
            value: p,
            label: p.charAt(0) + p.slice(1).toLowerCase(),
          }))}
        />
        <SelectInput
          label="Assignee"
          value={assigneeId}
          onChange={setAssigneeId}
          options={assigneeOptions}
          placeholder={assignees.loading ? 'Loading…' : 'Unassigned'}
        />
        {create.error ? (
          <Text style={{ fontSize: fontSize.sm, color: colors.danger, marginTop: spacing.xs }}>
            {create.error}
          </Text>
        ) : null}
      </View>
    </Sheet>
  );
}

/**
 * Colored status line for a task row. Returns null for a task with no due date.
 * Overdue is red, imminent is amber, a future/completed date is muted — matching
 * the web list where only urgency is coloured.
 */
function statusLine(
  dueAt: string | null | undefined,
  status: TaskStatus,
  colors: Palette,
): { color: string; text: string } | null {
  if (!dueAt) return null;
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) return null;
  const dateStr = due.toLocaleDateString();

  if (DONE_STATUSES.includes(status)) return { color: colors.muted, text: dateStr };

  const diff = due.getTime() - Date.now();
  const day = 24 * 60 * 60 * 1000;
  if (diff < 0) return { color: colors.danger, text: `Overdue · ${dateStr}` };
  if (diff < day) return { color: colors.warn, text: 'Due today' };
  if (diff < 2 * day) return { color: colors.warn, text: 'Due tomorrow' };
  return { color: colors.muted, text: dateStr };
}
