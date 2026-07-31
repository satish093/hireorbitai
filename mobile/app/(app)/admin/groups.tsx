import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Screen, Banner } from '../../../src/components/ui/Screen';
import { PageTopBar } from '../../../src/components/ui/TopBar';
import { Card, SectionHeader, Divider } from '../../../src/components/ui/Card';
import { Button } from '../../../src/components/ui/Button';
import { FormInput } from '../../../src/components/ui/Inputs';
import { Pill } from '../../../src/components/ui/Pill';
import { ConfirmSheet } from '../../../src/components/ui/Sheet';
import { RouteGuard } from '../../../src/components/RouteGuard';
import { useApiQuery, useApiList, useApiMutation } from '../../../src/hooks/useApi';
import { ADMIN_TIER, ROLE_LABEL, type Role, type UserGroup } from '../../../src/types';
import { useTheme } from '../../../src/theme';

/**
 * User groups — full management, mirroring the web console.
 *
 * Groups are the multi-tenancy primitive: `users.group_id` drives group-lead
 * scoping and the messaging permission engine, so membership changes silently
 * rewrite who can reach whom. ADMIN_TIER (or a DEVELOPER with `user_groups`).
 *
 * Create: POST /user-groups {name, slug, color, email}. Per group: PATCH
 * /user-groups/:id (email / is_active pause), DELETE /user-groups/:id, and
 * PUT /user-groups/assign {user_id, group_id|null} to add/remove a member.
 * Members are derived from GET /admin/users (grouped by group_id).
 */
export default function UserGroupsScreen() {
  return (
    <RouteGuard allow={[...ADMIN_TIER]} capability="user_groups">
      <UserGroupsList />
    </RouteGuard>
  );
}

interface AdminUser {
  id: string;
  email: string;
  full_name?: string | null;
  role: Role;
  group_id?: string | null;
}

const SWATCHES = [
  '#6366F1',
  '#0ea5e9',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#ec4899',
  '#8b5cf6',
  '#14b8a6',
];

const toSlug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

function UserGroupsList() {
  const { colors, spacing, fontSize } = useTheme();
  const insets = useSafeAreaInsets();

  const groups = useApiList<UserGroup>('/user-groups', { channel: 'user-groups' });
  // Members are derived from the user list (the list endpoint only returns counts).
  const usersQuery = useApiQuery<{ rows?: AdminUser[] }>('/admin/users', {
    channel: 'users',
    params: { page_size: 200 },
  });
  const allUsers = usersQuery.data?.rows ?? [];
  const membersByGroup = useMemo(() => {
    const m = new Map<string, AdminUser[]>();
    for (const u of allUsers) {
      if (!u.group_id) continue;
      const arr = m.get(u.group_id) ?? [];
      arr.push(u);
      m.set(u.group_id, arr);
    }
    return m;
  }, [allUsers]);

  // Create form
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [color, setColor] = useState(SWATCHES[0]!);
  const [email, setEmail] = useState('');
  const create = useApiMutation<Record<string, string>>('post', '/user-groups', {
    invalidates: ['user-groups'],
  });

  const onName = (v: string) => {
    setName(v);
    if (!slugTouched) setSlug(toSlug(v));
  };

  const submitCreate = async () => {
    if (!name.trim() || !slug.trim()) return;
    const body: Record<string, string> = { name: name.trim(), slug: slug.trim(), color };
    if (email.trim()) body.email = email.trim();
    const ok = await create.mutate(body);
    if (ok) {
      setName('');
      setSlug('');
      setSlugTouched(false);
      setColor(SWATCHES[0]!);
      setEmail('');
      void groups.refetch();
    }
  };

  const refetchAll = () => {
    void groups.refetch();
    void usersQuery.refetch();
  };

  return (
    <Screen edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <PageTopBar title="User groups" subtitle={`${groups.items.length} groups`} showBack />
      <ScrollView
        style={{ flex: 1 }}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          padding: spacing.lg,
          paddingBottom: spacing['4xl'] + insets.bottom,
          gap: spacing.lg,
        }}
      >
        {/* Create group */}
        <Card>
          <SectionHeader title="Create group" />
          <FormInput
            label="Group name"
            value={name}
            onChangeText={onName}
            placeholder="e.g. Cloudfen"
          />
          <FormInput
            label="Slug"
            value={slug}
            onChangeText={(v) => {
              setSlugTouched(true);
              setSlug(toSlug(v));
            }}
            placeholder="cloudfen"
            autoCapitalize="none"
          />
          <Text
            style={{
              fontSize: fontSize.sm,
              fontWeight: '600',
              color: colors.ink2,
              marginBottom: 6,
            }}
          >
            Color
          </Text>
          <View
            style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: spacing.md }}
          >
            {SWATCHES.map((c) => (
              <Pressable
                key={c}
                onPress={() => setColor(c)}
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 8,
                  backgroundColor: c,
                  borderWidth: color === c ? 3 : 0,
                  borderColor: colors.ink,
                }}
              />
            ))}
          </View>
          <FormInput
            label="Billing email (for invoices)"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
          />
          {create.error ? <Banner tone="danger" message={create.error} /> : null}
          <Button
            label={create.pending ? 'Creating…' : '+ Create group'}
            onPress={submitCreate}
            loading={create.pending}
            disabled={!name.trim() || !slug.trim() || create.pending}
          />
        </Card>

        {groups.error ? <Banner tone="danger" message={groups.error} /> : null}

        {groups.items.map((g) => (
          <GroupCard
            key={g.id}
            group={g}
            members={membersByGroup.get(g.id) ?? []}
            candidates={allUsers.filter((u) => u.group_id !== g.id)}
            onChanged={refetchAll}
          />
        ))}

        {!groups.loading && groups.items.length === 0 ? (
          <Text style={{ fontSize: fontSize.sm, color: colors.muted, textAlign: 'center' }}>
            No groups yet — create one above.
          </Text>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function GroupCard({
  group,
  members,
  candidates,
  onChanged,
}: {
  group: UserGroup;
  members: AdminUser[];
  candidates: AdminUser[];
  onChanged: () => void;
}) {
  const { colors, spacing, fontSize } = useTheme();
  const [emailDraft, setEmailDraft] = useState(group.email ?? '');
  const [addOpen, setAddOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const patch = useApiMutation<Record<string, unknown>>('patch', '/user-groups', {
    invalidates: ['user-groups'],
  });
  const del = useApiMutation('delete', '/user-groups', { invalidates: ['user-groups'] });
  const assign = useApiMutation<{ user_id: string; group_id: string | null }>(
    'put',
    '/user-groups/assign',
    { invalidates: ['user-groups', 'users'] },
  );

  const paused = group.is_active === false;
  const count = group.member_count ?? members.length;

  const saveEmail = async () => {
    const ok = await patch.mutate({ email: emailDraft.trim() }, `/user-groups/${group.id}`);
    if (ok) onChanged();
  };
  const togglePause = async () => {
    const ok = await patch.mutate({ is_active: paused }, `/user-groups/${group.id}`);
    if (ok) onChanged();
  };
  const remove = async () => {
    const ok = await del.mutate(undefined, `/user-groups/${group.id}`);
    setConfirmDelete(false);
    if (ok) onChanged();
  };
  const addMember = async (userId: string) => {
    const ok = await assign.mutate({ user_id: userId, group_id: group.id });
    if (ok) onChanged();
  };
  const removeMember = async (userId: string) => {
    const ok = await assign.mutate({ user_id: userId, group_id: null });
    if (ok) onChanged();
  };

  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <View
          style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            backgroundColor: group.color ?? colors.accent,
          }}
        />
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <Text
              numberOfLines={1}
              style={{ fontSize: fontSize.md, fontWeight: '700', color: colors.ink }}
            >
              {group.name}
            </Text>
            <Pill label={group.slug} tone="neutral" size="sm" />
            {paused ? <Pill label="Paused" tone="warn" size="sm" /> : null}
          </View>
          <Text style={{ fontSize: fontSize.xs, color: colors.muted, marginTop: 2 }}>
            {count} {count === 1 ? 'member' : 'members'}
          </Text>
        </View>
      </View>

      <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
        <View style={{ flex: 1 }}>
          <Button
            label={paused ? 'Resume' : 'Pause'}
            variant="secondary"
            size="sm"
            loading={patch.pending}
            onPress={togglePause}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            label="Delete"
            variant="danger-ghost"
            size="sm"
            onPress={() => setConfirmDelete(true)}
          />
        </View>
      </View>

      <Divider />
      <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-end' }}>
        <View style={{ flex: 1 }}>
          <FormInput
            label="Billing email (for invoices)"
            value={emailDraft}
            onChangeText={setEmailDraft}
            keyboardType="email-address"
            autoCapitalize="none"
          />
        </View>
        <View style={{ marginBottom: spacing.md }}>
          <Button
            label="Save"
            variant="secondary"
            size="sm"
            block={false}
            loading={patch.pending}
            onPress={saveEmail}
          />
        </View>
      </View>

      {assign.error ? <Banner tone="danger" message={assign.error} /> : null}

      <SectionHeader title="Members" />
      {members.length === 0 ? (
        <Text style={{ fontSize: fontSize.sm, color: colors.muted }}>No members yet.</Text>
      ) : (
        members.map((u) => (
          <View
            key={u.id}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing.sm,
              paddingVertical: 6,
            }}
          >
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ fontSize: fontSize.base, color: colors.ink }}>
                {u.full_name?.trim() || u.email}
              </Text>
            </View>
            <Pill label={ROLE_LABEL[u.role] ?? u.role} tone="neutral" size="sm" />
            <Pressable onPress={() => void removeMember(u.id)} hitSlop={8}>
              <Text style={{ fontSize: fontSize.sm, color: colors.danger, fontWeight: '600' }}>
                Remove
              </Text>
            </Pressable>
          </View>
        ))
      )}

      <Pressable onPress={() => setAddOpen((v) => !v)} style={{ marginTop: spacing.sm }}>
        <Text style={{ fontSize: fontSize.sm, color: colors.accent, fontWeight: '700' }}>
          {addOpen ? '▾ Add member' : '▸ + Add member'}
        </Text>
      </Pressable>
      {addOpen ? (
        <View style={{ marginTop: spacing.sm, gap: 2 }}>
          {candidates.length === 0 ? (
            <Text style={{ fontSize: fontSize.sm, color: colors.muted }}>No one to add.</Text>
          ) : (
            candidates.slice(0, 40).map((u) => (
              <Pressable
                key={u.id}
                onPress={() => void addMember(u.id)}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: spacing.sm,
                  paddingVertical: 8,
                  paddingHorizontal: spacing.sm,
                  borderRadius: 8,
                  backgroundColor: pressed ? colors.hover : 'transparent',
                })}
              >
                <Text style={{ fontSize: 16, color: colors.accent }}>+</Text>
                <Text
                  numberOfLines={1}
                  style={{ flex: 1, fontSize: fontSize.base, color: colors.ink }}
                >
                  {u.full_name?.trim() || u.email}
                </Text>
                <Pill label={ROLE_LABEL[u.role] ?? u.role} tone="neutral" size="sm" />
              </Pressable>
            ))
          )}
          {candidates.length > 40 ? (
            <Text style={{ fontSize: fontSize.xs, color: colors.faint, marginTop: 4 }}>
              Showing 40 of {candidates.length}. Move others from their profile.
            </Text>
          ) : null}
        </View>
      ) : null}

      <ConfirmSheet
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={remove}
        title={`Delete ${group.name}?`}
        message="Members fall back to no group. This cannot be undone."
        confirmLabel="Delete group"
        destructive
        pending={del.pending}
      />
    </Card>
  );
}
