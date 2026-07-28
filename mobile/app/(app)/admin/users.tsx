import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ListScreen, PageHeader, Banner } from '../../../src/components/ui/Screen';
import { Card } from '../../../src/components/ui/Card';
import { Pill } from '../../../src/components/ui/Pill';
import { Avatar } from '../../../src/components/ui/Avatar';
import { SearchInput } from '../../../src/components/ui/Inputs';
import { Tabs } from '../../../src/components/ui/Tabs';
import { RouteGuard } from '../../../src/components/RouteGuard';
import { useApiQuery } from '../../../src/hooks/useApi';
import { useAuth } from '../../../src/context/AuthContext';
import { ADMIN_TIER, ROLE_LABEL, outranks, type Role, type UserProfile } from '../../../src/types';
import { useTheme } from '../../../src/theme';

/**
 * User management — GET /admin/users (paginated) + GET /admin/users/kpi (counts).
 *
 * ADMIN_TIER, or a DEVELOPER holding the `users` capability.
 *
 * Row lifecycle actions (deactivate, reset, force-password-change) live on the
 * detail screen, gated by rank the same way the web console gates them. The
 * list itself surfaces state and the segment the web's UserSegments ribbon
 * uses, and taps through to /(app)/admin/user/[id].
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

// GET /admin/users returns a paginated envelope, NOT a bare array — useApiList
// (which only unwraps `data`/`items`) would silently yield []. Fetch the
// envelope directly and pull `.rows` / `.total`.
interface AdminUsersResponse {
  rows: AdminUserRow[];
  total?: number;
}

interface UsersKpi {
  total?: number;
  recruiters?: number;
  consultants?: number;
  managers?: number;
  pending?: number;
  locked?: number;
}

const STATUS_TONE: Record<string, 'success' | 'warn' | 'danger' | 'neutral'> = {
  active: 'success',
  suspended: 'warn',
  deactivated: 'neutral',
  inactive: 'neutral',
  banned: 'danger',
};

// Server-side segments (adminUsers.controller `SEGMENTS`). Only the subset the
// web's UserSegments ribbon leads with.
type Segment = 'all' | 'recruiters' | 'consultants' | 'managers' | 'pending' | 'locked';

function AdminUsersList() {
  const { profile } = useAuth();
  const router = useRouter();
  const { colors, spacing, fontSize } = useTheme();
  const [query, setQuery] = useState('');
  const [segment, setSegment] = useState<Segment>('all');

  const params = useMemo(() => (segment === 'all' ? undefined : { segment }), [segment]);

  const { data, loading, refreshing, error, onRefresh, refetch } = useApiQuery<AdminUsersResponse>(
    '/admin/users',
    { channel: 'users', params },
  );
  const kpi = useApiQuery<UsersKpi>('/admin/users/kpi', { channel: 'users' });

  const rows = data?.rows ?? [];
  const total = data?.total ?? rows.length;
  const k = kpi.data;

  // Search filters the current page client-side (server pagination is out of
  // scope for the mobile view — the segment already narrows the set server-side).
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (u) =>
        u.full_name?.toLowerCase().includes(q) ||
        u.email?.toLowerCase().includes(q) ||
        u.role?.toLowerCase().includes(q),
    );
  }, [rows, query]);

  return (
    <>
      <PageHeader title="Users" subtitle={`${total} accounts`} />
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
              placeholder="Search this page by name, email or role"
            />
            <Tabs
              value={segment}
              onChange={(s) => setSegment(s as Segment)}
              items={[
                { key: 'all', label: 'All', count: k?.total },
                { key: 'recruiters', label: 'Recruiters', count: k?.recruiters },
                { key: 'consultants', label: 'Consultants', count: k?.consultants },
                { key: 'managers', label: 'Managers', count: k?.managers },
                { key: 'pending', label: 'Pending', count: k?.pending },
                { key: 'locked', label: 'Locked', count: k?.locked },
              ]}
            />
            <Banner
              tone="info"
              message="Tap a user to open their profile, where lifecycle actions live. Rank guards apply — you can only act on accounts you outrank."
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
