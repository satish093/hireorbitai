import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Screen, ListScreen, Banner } from '../../../src/components/ui/Screen';
import { PageTopBar } from '../../../src/components/ui/TopBar';
import { Divider, MetricTile } from '../../../src/components/ui/Card';
import { Button } from '../../../src/components/ui/Button';
import { pillToneColor, type PillTone } from '../../../src/components/ui/Pill';
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
 * The "outranks you" hint makes the boundary visible: a row you do not outrank
 * is one you could not act on anyway — the server would refuse.
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
  active?: number;
  online?: number;
  inactive?: number;
  recruiters?: number;
  consultants?: number;
  managers?: number;
  pending?: number;
  locked?: number;
  forced_reset?: number;
  no_login_30d?: number;
}

const STATUS_TONE: Record<string, PillTone> = {
  active: 'success',
  suspended: 'warn',
  deactivated: 'neutral',
  inactive: 'neutral',
  banned: 'danger',
};

const titleCase = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s);

// Server-side segments (adminUsers.controller `SEGMENTS`) — the full ribbon.
type Segment =
  | 'all'
  | 'recruiters'
  | 'consultants'
  | 'managers'
  | 'pending'
  | 'locked'
  | 'forced_reset'
  | 'no_login_30d';

function AdminUsersList() {
  const { profile } = useAuth();
  const router = useRouter();
  const { colors, spacing, fontSize } = useTheme();
  const insets = useSafeAreaInsets();
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
    <Screen edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <PageTopBar
        title="Users"
        subtitle="Every account in the workspace — filter, inspect, and manage lifecycle."
        showBack
      />
      <ListScreen
        items={filtered}
        loading={loading}
        refreshing={refreshing}
        error={error}
        onRefresh={onRefresh}
        onRetry={() => void refetch()}
        keyExtractor={(u) => u.id}
        ItemSeparatorComponent={() => <Divider inset={56} />}
        contentContainerStyle={{
          paddingHorizontal: spacing.lg,
          paddingTop: spacing.sm,
          paddingBottom: spacing['4xl'] + insets.bottom,
          flexGrow: 1,
        }}
        header={
          <View style={{ gap: spacing.md, marginBottom: spacing.xs }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <Text style={{ flex: 1, fontSize: fontSize.sm, color: colors.muted }}>
                {total} users
              </Text>
              <Button
                label="Deactivated"
                variant="secondary"
                size="sm"
                block={false}
                onPress={() => router.push('/(app)/admin/deactivated')}
              />
              <Button
                label="Invite"
                size="sm"
                block={false}
                onPress={() => router.push('/(app)/invitations')}
              />
            </View>

            {profile?.role === 'SUPER_ADMIN' ? (
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: spacing.sm,
                  backgroundColor: colors.ink,
                  borderRadius: 12,
                  paddingHorizontal: spacing.md,
                  paddingVertical: spacing.md,
                }}
              >
                <Text style={{ fontSize: 16 }}>🛡️</Text>
                <Text
                  style={{ flex: 1, fontSize: fontSize.sm, fontWeight: '700', color: colors.bg }}
                >
                  Full access — you can view and edit every account, including other admins.
                </Text>
                <View
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 5,
                    backgroundColor: colors.success,
                  }}
                />
              </View>
            ) : null}

            {/* KPI cards */}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
              <MetricTile label="Active" value={k?.active ?? 0} tone="success" accent="green" />
              <MetricTile
                label="Online now"
                value={k?.online ?? 0}
                hint="last 5 min"
                accent="brand"
              />
              <MetricTile
                label="Pending invites"
                value={k?.pending ?? 0}
                tone={k?.pending ? 'warn' : 'default'}
                accent="amber"
              />
              <MetricTile
                label="Locked"
                value={k?.locked ?? 0}
                hint="suspended / banned"
                tone={k?.locked ? 'danger' : 'default'}
                accent="red"
              />
              <MetricTile
                label="Inactive 30d"
                value={k?.inactive ?? 0}
                hint="no activity in 30d"
                accent="slate"
              />
            </View>

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
                { key: 'managers', label: 'Managers + admins', count: k?.managers },
                { key: 'pending', label: 'Pending invites', count: k?.pending },
                { key: 'locked', label: 'Locked', count: k?.locked },
                { key: 'forced_reset', label: 'Forced password reset', count: k?.forced_reset },
                { key: 'no_login_30d', label: 'No login > 30d', count: k?.no_login_30d },
              ]}
            />
          </View>
        }
        emptyTitle={query ? 'No matches' : 'No users'}
        emptyDescription={
          query
            ? 'Try a different name, email or role.'
            : 'Accounts appear here as they are created.'
        }
        renderItem={({ item }) => {
          const canAct = profile ? outranks(profile.role, item.role) : false;
          const status = (item.status ?? 'active').toLowerCase();
          const sub = [item.group_name, canAct ? null : 'outranks you'].filter(Boolean).join(' · ');
          return (
            <Pressable
              onPress={() => router.push(`/(app)/admin/user/${item.id}`)}
              accessibilityRole="button"
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.md,
                paddingVertical: 12,
                backgroundColor: pressed ? colors.hover : 'transparent',
              })}
            >
              <Avatar
                id={item.id}
                name={item.full_name}
                email={item.email}
                uri={item.avatar_url}
                size={44}
              />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text
                  numberOfLines={1}
                  style={{ fontSize: fontSize.md, fontWeight: '600', color: colors.ink }}
                >
                  {item.full_name?.trim() || item.email}
                </Text>
                <Text numberOfLines={1} style={{ fontSize: fontSize.sm, color: colors.muted }}>
                  {ROLE_LABEL[item.role] ?? item.role} · {item.email}
                </Text>
                {sub ? (
                  <Text numberOfLines={1} style={{ fontSize: fontSize.xs, color: colors.faint }}>
                    {sub}
                  </Text>
                ) : null}
              </View>
              <StatusText
                label={titleCase(status)}
                color={pillToneColor(STATUS_TONE[status] ?? 'neutral', colors)}
              />
            </Pressable>
          );
        }}
      />
    </Screen>
  );
}

/** Inline status = a small colored dot + colored text (the website's row status). */
function StatusText({ label, color }: { label: string; color: string }) {
  const { fontSize } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: color }} />
      <Text style={{ fontSize: fontSize.sm, fontWeight: '600', color }}>{label}</Text>
    </View>
  );
}
