import { Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Screen, ListScreen } from '../../../src/components/ui/Screen';
import { PageTopBar } from '../../../src/components/ui/TopBar';
import { Divider } from '../../../src/components/ui/Card';
import { RouteGuard } from '../../../src/components/RouteGuard';
import { useApiList } from '../../../src/hooks/useApi';
import { ADMIN_TIER, type UserGroup } from '../../../src/types';
import { useTheme } from '../../../src/theme';

interface GroupRow extends UserGroup {
  member_count?: number | null;
}

/**
 * User groups — GET /user-groups.
 *
 * Groups are the multi-tenancy primitive ("Cloudfen", "Zangle IT", …). They
 * matter well beyond labelling: `users.group_id` drives group-lead scoping in
 * groupScope.ts and the group branch of the messaging permission engine, so a
 * group change silently rewrites who can reach whom.
 *
 * That is exactly why this screen is read-only. Creating and re-scoping groups
 * belongs on the web console.
 */
export default function UserGroupsScreen() {
  return (
    <RouteGuard allow={[...ADMIN_TIER]} capability="user_groups">
      <UserGroupsList />
    </RouteGuard>
  );
}

function UserGroupsList() {
  const { colors, spacing, fontSize } = useTheme();
  const insets = useSafeAreaInsets();

  const { items, loading, refreshing, error, onRefresh, refetch } = useApiList<GroupRow>(
    '/user-groups',
    { channel: 'user-groups' },
  );

  return (
    <Screen edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <PageTopBar title="User groups" subtitle={`${items.length} groups`} showBack />
      <ListScreen
        items={items}
        loading={loading}
        refreshing={refreshing}
        error={error}
        onRefresh={onRefresh}
        onRetry={() => void refetch()}
        keyExtractor={(g) => g.id}
        ItemSeparatorComponent={() => <Divider />}
        contentContainerStyle={{
          paddingHorizontal: spacing.lg,
          paddingTop: spacing.sm,
          paddingBottom: spacing['4xl'] + insets.bottom,
          flexGrow: 1,
        }}
        emptyTitle="No groups"
        emptyDescription="Groups partition the workspace into separate teams."
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
                numberOfLines={1}
                style={{ fontSize: fontSize.md, fontWeight: '600', color: colors.ink }}
              >
                {item.name}
              </Text>
              <Text numberOfLines={1} style={{ fontSize: fontSize.sm, color: colors.muted }}>
                {item.email ? `${item.slug} · ${item.email}` : item.slug}
              </Text>
            </View>
            {typeof item.member_count === 'number' ? (
              <Text style={{ fontSize: fontSize.sm, fontWeight: '600', color: colors.ink2 }}>
                {item.member_count} {item.member_count === 1 ? 'member' : 'members'}
              </Text>
            ) : null}
          </View>
        )}
      />
    </Screen>
  );
}
