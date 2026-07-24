import { Text, View } from 'react-native';
import { ListScreen, PageHeader } from '../../../src/components/ui/Screen';
import { Card } from '../../../src/components/ui/Card';
import { Pill } from '../../../src/components/ui/Pill';
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

  const { items, loading, refreshing, error, onRefresh, refetch } = useApiList<GroupRow>(
    '/user-groups',
    { channel: 'user-groups' },
  );

  return (
    <>
      <PageHeader title="User groups" subtitle={`${items.length} groups`} />
      <ListScreen
        items={items}
        loading={loading}
        refreshing={refreshing}
        error={error}
        onRefresh={onRefresh}
        onRetry={() => void refetch()}
        keyExtractor={(g) => g.id}
        emptyTitle="No groups"
        emptyDescription="Groups partition the workspace into separate teams."
        renderItem={({ item }) => (
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
              <View style={{ flex: 1 }}>
                <Text
                  numberOfLines={1}
                  style={{ fontSize: fontSize.md, fontWeight: '600', color: colors.ink }}
                >
                  {item.name}
                </Text>
                <Text style={{ fontSize: fontSize.sm, color: colors.muted, marginTop: 2 }}>
                  {item.slug}
                </Text>
                {item.email ? (
                  <Text
                    numberOfLines={1}
                    style={{ fontSize: fontSize.xs, color: colors.faint, marginTop: 2 }}
                  >
                    {item.email}
                  </Text>
                ) : null}
              </View>
              {typeof item.member_count === 'number' ? (
                <Pill label={`${item.member_count} members`} tone="brand" size="sm" />
              ) : null}
            </View>
          </Card>
        )}
      />
    </>
  );
}
