import { Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { ScreenScroll, Banner } from '../../../../src/components/ui/Screen';
import { Card, SectionHeader, DetailRow, Divider } from '../../../../src/components/ui/Card';
import { Pill } from '../../../../src/components/ui/Pill';
import { Avatar } from '../../../../src/components/ui/Avatar';
import { SkeletonCard, ErrorState, EmptyState } from '../../../../src/components/ui/States';
import { RouteGuard } from '../../../../src/components/RouteGuard';
import { useApiQuery, useApiList } from '../../../../src/hooks/useApi';
import { useAuth } from '../../../../src/context/AuthContext';
import {
  ADMIN_TIER,
  ROLE_LABEL,
  outranks,
  type AuditLogEntry,
  type Role,
  type UserProfile,
} from '../../../../src/types';
import { useTheme } from '../../../../src/theme';
import { relativeDate } from '../../jobs';

interface AdminUserDetail extends Partial<UserProfile> {
  id: string;
  email: string;
  role: Role;
  status?: string | null;
  group_name?: string | null;
  last_login_at?: string | null;
  created_at?: string;
}

/**
 * User detail — GET /admin/users/:id plus their audit trail.
 *
 * Shows the two facts that decide whether an admin can act on this account at
 * all, so nobody has to guess why the web console refuses:
 *
 *   • RANK — assertOutranks() refuses to mutate an equal-or-higher tier user
 *   • CAPABILITIES — a DEVELOPER's grants are the whole of its access
 *
 * A DIRECTOR cannot lock out a SUPER_ADMIN; that is enforced server-side and
 * surfaced here rather than discovered through a 403.
 */
export default function AdminUserDetailScreen() {
  return (
    <RouteGuard allow={[...ADMIN_TIER]} capability="users">
      <AdminUserDetail />
    </RouteGuard>
  );
}

function AdminUserDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profile } = useAuth();
  const { colors, spacing, fontSize } = useTheme();

  const user = useApiQuery<AdminUserDetail>(id ? `/admin/users/${id}` : null, {
    channel: 'users',
    enabled: !!id,
  });

  const audit = useApiList<AuditLogEntry>(id ? `/admin/users/${id}/audit` : null, {
    channel: 'users',
    enabled: !!id,
  });

  const u = user.data;
  const canAct = profile && u ? outranks(profile.role, u.role) : false;

  return (
    <>
      <Stack.Screen options={{ title: 'User' }} />
      <ScreenScroll refreshing={user.refreshing} onRefresh={user.onRefresh} edges={[]}>
        {user.loading && !u ? (
          <SkeletonCard />
        ) : user.error && !u ? (
          <ErrorState message={user.error} onRetry={() => void user.refetch()} />
        ) : !u ? (
          <Banner tone="warn" message="This account is no longer available." />
        ) : (
          <>
            <Card>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                <Avatar id={u.id} name={u.full_name} email={u.email} uri={u.avatar_url} size={56} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: fontSize.lg, fontWeight: '700', color: colors.ink }}>
                    {u.full_name?.trim() || u.email}
                  </Text>
                  <Text style={{ fontSize: fontSize.sm, color: colors.muted }}>{u.email}</Text>
                  <View style={{ flexDirection: 'row', gap: 6, marginTop: 6 }}>
                    <Pill label={ROLE_LABEL[u.role] ?? u.role} tone="brand" size="sm" />
                    <Pill
                      label={(u.status ?? 'active').toLowerCase()}
                      tone={
                        (u.status ?? 'active').toLowerCase() === 'active' ? 'success' : 'danger'
                      }
                      size="sm"
                    />
                  </View>
                </View>
              </View>

              {!canAct ? (
                <View style={{ marginTop: spacing.lg }}>
                  <Banner
                    tone="warn"
                    message="This account is equal to or above your rank, so account actions on it are refused server-side."
                  />
                </View>
              ) : null}
            </Card>

            <Card>
              <SectionHeader title="Account" />
              <DetailRow label="Group" value={u.group_name ?? '—'} />
              <Divider />
              <DetailRow label="Phone" value={u.phone ?? '—'} />
              <Divider />
              <DetailRow
                label="Last sign-in"
                value={u.last_login_at ? relativeDate(u.last_login_at) : 'Never'}
              />
              <Divider />
              <DetailRow
                label="Created"
                value={u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'}
              />
              <Divider />
              <DetailRow
                label="Temp password"
                value={u.must_change_password ? 'Rotation required' : 'No'}
              />
            </Card>

            {u.role === 'DEVELOPER' ? (
              <Card>
                <SectionHeader
                  title="Capabilities"
                  subtitle="A DEVELOPER has no tier access — these grants are the whole of it."
                />
                {u.capabilities?.length ? (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    {u.capabilities.map((c) => (
                      <Pill key={c} label={c.replace(/_/g, ' ')} tone="accent" size="sm" />
                    ))}
                  </View>
                ) : (
                  <EmptyState
                    compact
                    title="No capabilities granted"
                    description="This developer can reach only the messenger."
                  />
                )}
              </Card>
            ) : null}

            <Card>
              <SectionHeader title="Recent activity" />
              {audit.loading ? (
                <SkeletonCard />
              ) : audit.items.length === 0 ? (
                <EmptyState compact title="No audit events" />
              ) : (
                audit.items.slice(0, 20).map((e, i) => (
                  <View key={e.id}>
                    {i > 0 ? <Divider /> : null}
                    <View style={{ paddingVertical: 10 }}>
                      <Text style={{ fontSize: fontSize.base, color: colors.ink }}>
                        {e.action.replace(/_/g, ' ').toLowerCase()}
                      </Text>
                      <Text style={{ fontSize: fontSize.xs, color: colors.faint, marginTop: 2 }}>
                        {relativeDate(e.created_at)}
                        {e.ip_address ? ` · ${e.ip_address}` : ''}
                      </Text>
                    </View>
                  </View>
                ))
              )}
            </Card>
          </>
        )}
      </ScreenScroll>
    </>
  );
}
