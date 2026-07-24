import { Text, View } from 'react-native';
import { ListScreen, PageHeader, Banner } from '../../../src/components/ui/Screen';
import { Card } from '../../../src/components/ui/Card';
import { Pill } from '../../../src/components/ui/Pill';
import { Avatar } from '../../../src/components/ui/Avatar';
import { RouteGuard } from '../../../src/components/RouteGuard';
import { useApiList } from '../../../src/hooks/useApi';
import { ADMIN_TIER, ROLE_LABEL, type Role, type UserProfile } from '../../../src/types';
import { useTheme } from '../../../src/theme';
import { relativeDate } from '../jobs';

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
 * relationships. Reactivation is a web-console action for the same reason the
 * other lifecycle verbs are.
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

  const { items, loading, refreshing, error, onRefresh, refetch } = useApiList<DeactivatedRow>(
    '/users/deactivated',
    { channel: 'users' },
  );

  return (
    <>
      <PageHeader title="Deactivated" subtitle={`${items.length} accounts`} />
      <ListScreen
        items={items}
        loading={loading}
        refreshing={refreshing}
        error={error}
        onRefresh={onRefresh}
        onRetry={() => void refetch()}
        keyExtractor={(u) => u.id}
        header={
          <Banner
            tone="info"
            message="These accounts can't sign in. Their history and relationships are preserved. Reactivate from the web console."
          />
        }
        emptyTitle="No deactivated accounts"
        emptyDescription="Everyone in the workspace is active."
        renderItem={({ item }) => (
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
              <Avatar id={item.id} name={item.full_name} email={item.email} size={40} />
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
                {item.updated_at ? (
                  <Text style={{ fontSize: fontSize.xs, color: colors.faint, marginTop: 2 }}>
                    Deactivated {relativeDate(item.updated_at)}
                  </Text>
                ) : null}
              </View>
              <View style={{ alignItems: 'flex-end', gap: 6 }}>
                <Pill label={ROLE_LABEL[item.role] ?? item.role} tone="neutral" size="sm" />
                <Pill label={item.status ?? 'deactivated'} tone="danger" size="sm" />
              </View>
            </View>
          </Card>
        )}
      />
    </>
  );
}
