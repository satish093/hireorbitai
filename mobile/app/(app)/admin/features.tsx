import { useState } from 'react';
import { Switch, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Screen, ListScreen, Banner } from '../../../src/components/ui/Screen';
import { PageTopBar } from '../../../src/components/ui/TopBar';
import { Divider } from '../../../src/components/ui/Card';
import { RouteGuard } from '../../../src/components/RouteGuard';
import { useApiList } from '../../../src/hooks/useApi';
import { invalidate } from '../../../src/hooks/useInvalidate';
import { api, apiErrorMessage } from '../../../src/services/api';
import { useAuth } from '../../../src/context/AuthContext';
import { ADMIN_TIER, OWNER_TIER } from '../../../src/types';
import { useTheme } from '../../../src/theme';

interface FlagRow {
  key: string;
  enabled: boolean;
  description?: string | null;
}

/**
 * Feature flags — GET /feature-flags, PATCH /feature-flags/:key.
 *
 * ADMIN_TIER, or a DEVELOPER with the `feature_flags` capability.
 *
 * Toggling is optimistic and REVERTS on failure. That matters more here than
 * almost anywhere else: a flag controls whether a whole module is reachable for
 * a group, so a switch that looks flipped but didn't save would leave an admin
 * believing they had turned something off when they had not.
 *
 * After a successful toggle the 'feature-flags' channel is invalidated, so the
 * app's own FeatureFlagsProvider re-fetches and every guard re-evaluates
 * immediately — the same live-update path the web uses.
 */
export default function FeatureFlagsScreen() {
  return (
    <RouteGuard allow={[...ADMIN_TIER]} capability="feature_flags">
      <FeatureFlagsList />
    </RouteGuard>
  );
}

function FeatureFlagsList() {
  const { colors, spacing, fontSize } = useTheme();
  const insets = useSafeAreaInsets();
  const { profile } = useAuth();
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // WRITES are OWNER_TIER only (SUPER_ADMIN + CEO). CTO / DIRECTOR and a
  // DEVELOPER with the `feature_flags` capability can READ the list but the
  // backend rejects PATCH regardless — so the switch is read-only for them,
  // mirroring the web's `canWrite` gate. Showing an interactive toggle they
  // can't use would just 403 on tap.
  const canWrite = !!profile && (OWNER_TIER as readonly string[]).includes(profile.role);

  const flags = useApiList<FlagRow>('/feature-flags', { channel: 'feature-flags' });

  const toggle = async (row: FlagRow, next: boolean) => {
    setPendingKey(row.key);
    setError(null);
    // Optimistic — the switch should respond instantly.
    flags.setData((prev) =>
      (prev ?? []).map((f) => (f.key === row.key ? { ...f, enabled: next } : f)),
    );
    try {
      await api.patch(`/feature-flags/${row.key}`, { enabled: next });
      // Re-hydrate the app's own flag map so guards react at once.
      invalidate('feature-flags');
    } catch (err) {
      // Revert — never leave the UI claiming a change that didn't persist.
      flags.setData((prev) =>
        (prev ?? []).map((f) => (f.key === row.key ? { ...f, enabled: !next } : f)),
      );
      setError(apiErrorMessage(err, `Could not change "${row.key}".`));
    } finally {
      setPendingKey(null);
    }
  };

  return (
    <Screen edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <PageTopBar title="Feature flags" subtitle={`${flags.items.length} modules`} showBack />
      <ListScreen
        items={flags.items}
        loading={flags.loading}
        refreshing={flags.refreshing}
        error={flags.error}
        onRefresh={flags.onRefresh}
        onRetry={() => void flags.refetch()}
        keyExtractor={(f) => f.key}
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
            {canWrite ? (
              <Banner
                tone="warn"
                message="Turning a flag off hides that module for every user it applies to, immediately."
              />
            ) : (
              <Banner
                tone="info"
                message="Read-only view. Only Super Admin and CEO can flip feature flags."
              />
            )}
          </View>
        }
        emptyTitle="No feature flags"
        renderItem={({ item }) => (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing.md,
              paddingVertical: 12,
            }}
          >
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text
                style={{
                  fontSize: fontSize.md,
                  fontWeight: '600',
                  color: colors.ink,
                  textTransform: 'capitalize',
                }}
              >
                {item.key.replace(/_/g, ' ')}
              </Text>
              {item.description ? (
                <Text style={{ fontSize: fontSize.sm, color: colors.muted, marginTop: 2 }}>
                  {item.description}
                </Text>
              ) : null}
            </View>
            <Switch
              value={item.enabled}
              disabled={!canWrite || pendingKey === item.key}
              onValueChange={(next) => void toggle(item, next)}
              trackColor={{ true: colors.accent, false: colors.borderStrong }}
            />
          </View>
        )}
      />
    </Screen>
  );
}
