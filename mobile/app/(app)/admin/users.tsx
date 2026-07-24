import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ListScreen, PageHeader, Banner } from '../../../src/components/ui/Screen';
import { Card } from '../../../src/components/ui/Card';
import { Pill } from '../../../src/components/ui/Pill';
import { Avatar } from '../../../src/components/ui/Avatar';
import { SearchInput } from '../../../src/components/ui/Inputs';
import { RouteGuard } from '../../../src/components/RouteGuard';
import { useApiList } from '../../../src/hooks/useApi';
import { useAuth } from '../../../src/context/AuthContext';
import { ADMIN_TIER, ROLE_LABEL, outranks, type Role, type UserProfile } from '../../../src/types';
import { useTheme } from '../../../src/theme';

/**
 * User management — GET /admin/users.
 *
 * ADMIN_TIER, or a DEVELOPER holding the `users` capability.
 *
 * Read-only on mobile, deliberately. The web's lifecycle actions (deactivate,
 * suspend, ban, delete, force password change, impersonate) are irreversible or
 * near-irreversible, and they are gated server-side by BOTH assertOutranks() and
 * assertNotLastSuperAdmin(). A mis-tap on a phone is a very different risk from
 * a deliberate click on a desktop admin console, so this screen surfaces state
 * and defers the destructive verbs to the web.
 *
 * The rank badge makes the boundary visible: a row you do not outrank is one you
 * could not act on anyway — the server would refuse.
 */
export default function AdminUsersScreen() {
  return (
    <RouteGuard allow={[...ADMIN_TIER]} capability="users">
      <AdminUsersList />
    </RouteGuard>
  );
}

interface AdminUserRow extends Partial<UserProfile> {
  id: string;
  email: string;
  role: Role;
  status?: string | null;
  group_name?: string | null;
  last_login_at?: string | null;
}

const STATUS_TONE: Record<string, 'success' | 'warn' | 'danger' | 'neutral'> = {
  active: 'success',
  suspended: 'warn',
  deactivated: 'neutral',
  banned: 'danger',
};

function AdminUsersList() {
  const { profile } = useAuth();
  const router = useRouter();
  const { colors, spacing, fontSize } = useTheme();
  const [query, setQuery] = useState('');

  const { items, loading, refreshing, error, onRefresh, refetch } = useApiList<AdminUserRow>(
    '/admin/users',
    { channel: 'users' },
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (u) =>
        u.full_name?.toLowerCase().includes(q) ||
        u.email?.toLowerCase().includes(q) ||
        u.role?.toLowerCase().includes(q),
    );
  }, [items, query]);

  return (
    <>
      <PageHeader title="Users" subtitle={`${items.length} accounts`} />
      <ListScreen
        items={filtered}
        loading={loading}
        refreshing={refreshing}
        error={error}
        onRefresh={onRefresh}
        onRetry={() => void refetch()}
        keyExtractor={(u) => u.id}
        header={
          <View style={{ gap: spacing.md }}>
            <SearchInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search name, email or role"
            />
            <Banner
              tone="info"
              message="Account actions (deactivate, reset, delete) are on the web console — they're irreversible and deliberately not one tap away here."
            />
          </View>
        }
        emptyTitle={query ? 'No matches' : 'No users'}
        renderItem={({ item }) => {
          const canAct = profile ? outranks(profile.role, item.role) : false;
          const status = (item.status ?? 'active').toLowerCase();
          return (
            <Card onPress={() => router.push(`/(app)/admin/user/${item.id}`)}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                <Avatar
                  id={item.id}
                  name={item.full_name}
                  email={item.email}
                  uri={item.avatar_url}
                  size={44}
                />
                <View style={{ flex: 1 }}>
                  <Text
                    numberOfLines={1}
                    style={{ fontSize: fontSize.md, fontWeight: '600', color: colors.ink }}
                  >
                    {item.full_name?.trim() || item.email}
                  </Text>
                  <Text numberOfLines={1} style={{ fontSize: fontSize.sm, color: colors.muted }}>
                    {item.email}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 6 }}>
                  <Pill label={ROLE_LABEL[item.role] ?? item.role} tone="brand" size="sm" />
                  <Pill label={status} tone={STATUS_TONE[status] ?? 'neutral'} size="sm" />
                </View>
              </View>

              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: spacing.sm,
                  marginTop: spacing.sm,
                }}
              >
                {item.group_name ? (
                  <Text style={{ fontSize: fontSize.xs, color: colors.faint }}>
                    {item.group_name}
                  </Text>
                ) : null}
                {!canAct ? (
                  <Text style={{ fontSize: fontSize.xs, color: colors.faint }}>· outranks you</Text>
                ) : null}
              </View>
            </Card>
          );
        }}
      />
    </>
  );
}
