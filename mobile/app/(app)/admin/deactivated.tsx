import { useState } from 'react';
import { Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Screen, ListScreen, Banner } from '../../../src/components/ui/Screen';
import { PageTopBar } from '../../../src/components/ui/TopBar';
import { Divider } from '../../../src/components/ui/Card';
import { pillToneColor } from '../../../src/components/ui/Pill';
import { Avatar } from '../../../src/components/ui/Avatar';
import { Button } from '../../../src/components/ui/Button';
import { ConfirmSheet } from '../../../src/components/ui/Sheet';
import { RouteGuard } from '../../../src/components/RouteGuard';
import { useApiList } from '../../../src/hooks/useApi';
import { useAuth } from '../../../src/context/AuthContext';
import { invalidate } from '../../../src/hooks/useInvalidate';
import { api, apiErrorMessage } from '../../../src/services/api';
import { ADMIN_TIER, ROLE_LABEL, outranks, type Role, type UserProfile } from '../../../src/types';
import { useTheme } from '../../../src/theme';
import { relativeDate } from '../../../src/utils/format';

interface DeactivatedRow extends Partial<UserProfile> {
  id: string;
  email: string;
  role: Role;
  status?: string | null;
  updated_at?: string | null;
}

/**
 * Deactivated accounts — GET /users/deactivated.
 *
 * A separate screen from Users because a deactivated account is invisible in the
 * main directory but still exists: it holds history, audit rows and
 * relationships.
 *
 * Reactivation IS available here — POST /users/:id/reactivate, the same endpoint
 * the web console uses, gated by ADMIN_TIER (requireAdmin) plus the server's own
 * rank guard (assertCanManageTarget) that refuses an equal-or-higher target. The
 * confirm sheet guards the mis-tap; the row hint makes an unactionable target
 * (one you don't outrank) obvious before you try.
 */
export default function DeactivatedScreen() {
  return (
    <RouteGuard allow={[...ADMIN_TIER]}>
      <DeactivatedList />
    </RouteGuard>
  );
}

function DeactivatedList() {
  const { colors, spacing, fontSize } = useTheme();
  const insets = useSafeAreaInsets();
  const { profile } = useAuth();
  const [confirm, setConfirm] = useState<DeactivatedRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const {
    items,
    loading,
    refreshing,
    error: loadError,
    onRefresh,
    refetch,
    setData,
  } = useApiList<DeactivatedRow>('/users/deactivated', { channel: 'users' });

  const reactivate = async (row: DeactivatedRow) => {
    setBusyId(row.id);
    setError(null);
    try {
      await api.post(`/users/${row.id}/reactivate`);
      setConfirm(null);
      // The row is no longer deactivated — drop it locally, then fan the change
      // out so the Users list / detail refetch the restored status.
      setData((prev) => (prev ?? []).filter((u) => u.id !== row.id));
      invalidate('users');
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not reactivate this account.'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Screen edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <PageTopBar title="Deactivated" subtitle={`${items.length} accounts`} showBack />
      <ListScreen
        items={items}
        loading={loading}
        refreshing={refreshing}
        error={loadError}
        onRefresh={onRefresh}
        onRetry={() => void refetch()}
        keyExtractor={(u) => u.id}
        ItemSeparatorComponent={() => <Divider />}
        contentContainerStyle={{
          paddingHorizontal: spacing.lg,
          paddingTop: spacing.sm,
          paddingBottom: spacing['4xl'] + insets.bottom,
          flexGrow: 1,
        }}
        header={
          <View style={{ gap: spacing.sm, marginBottom: spacing.xs }}>
            {error ? <Banner tone="danger" message={error} /> : null}
            <Banner
              tone="info"
              message="These accounts can't sign in. Their history and relationships are preserved — reactivating restores their previous role, group and permissions."
            />
          </View>
        }
        emptyTitle="No deactivated accounts"
        emptyDescription="Everyone in the workspace is active."
        renderItem={({ item }) => {
          const canAct = profile ? outranks(profile.role, item.role) : false;
          return (
            <View style={{ paddingVertical: 12, gap: spacing.sm }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                <Avatar id={item.id} name={item.full_name} email={item.email} size={44} />
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
                  {item.updated_at ? (
                    <Text style={{ fontSize: fontSize.xs, color: colors.faint }}>
                      Deactivated {relativeDate(item.updated_at)}
                    </Text>
                  ) : null}
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <View
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: 4,
                      backgroundColor: pillToneColor('danger', colors),
                    }}
                  />
                  <Text
                    style={{
                      fontSize: fontSize.sm,
                      fontWeight: '600',
                      color: pillToneColor('danger', colors),
                    }}
                  >
                    {item.status ?? 'Deactivated'}
                  </Text>
                </View>
              </View>

              {canAct ? (
                <Button
                  label="Reactivate"
                  variant="secondary"
                  size="sm"
                  loading={busyId === item.id}
                  onPress={() => setConfirm(item)}
                />
              ) : (
                <Text style={{ fontSize: fontSize.xs, color: colors.faint }}>
                  Outranks you — reactivation is refused server-side.
                </Text>
              )}
            </View>
          );
        }}
      />

      <ConfirmSheet
        open={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={() => confirm && void reactivate(confirm)}
        title="Reactivate account?"
        message={
          confirm
            ? `This re-enables ${confirm.full_name?.trim() || confirm.email} and lets them sign in again. Their role, group and permissions are restored to their previous state.`
            : undefined
        }
        confirmLabel="Reactivate"
        pending={!!busyId}
      />
    </Screen>
  );
}
