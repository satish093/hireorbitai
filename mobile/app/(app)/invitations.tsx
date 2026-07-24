import { Text, View } from 'react-native';
import { ListScreen, PageHeader, Banner } from '../../src/components/ui/Screen';
import { Card } from '../../src/components/ui/Card';
import { Pill, type PillTone } from '../../src/components/ui/Pill';
import { RouteGuard } from '../../src/components/RouteGuard';
import { useApiList } from '../../src/hooks/useApi';
import { OPERATOR_TIER, ROLE_LABEL, type Invitation } from '../../src/types';
import { useTheme } from '../../src/theme';
import { relativeDate } from './jobs';

/**
 * Invitations — GET /invitations.
 *
 * OPERATOR_TIER, or a DEVELOPER with the `invitations` capability.
 *
 * Read-only on mobile. Sending an invitation is rank-gated
 * (invitationHierarchy.service.ts decides who may invite whom, and
 * SUPER_ADMIN_ONLY_ROLES means only a SUPER_ADMIN can mint another SUPER_ADMIN
 * or a DEVELOPER) — a role picker that has to encode that correctly belongs on
 * the console, where the mis-tap risk is lower.
 */
export default function InvitationsScreen() {
  return (
    <RouteGuard allow={[...OPERATOR_TIER]} capability="invitations">
      <InvitationsList />
    </RouteGuard>
  );
}

function statusTone(status?: string | null, expiresAt?: string | null): PillTone {
  const s = (status ?? '').toLowerCase();
  if (s.includes('accept')) return 'success';
  if (s.includes('revok')) return 'danger';
  if (expiresAt && new Date(expiresAt).getTime() < Date.now()) return 'warn';
  return 'info';
}

function InvitationsList() {
  const { colors, spacing, fontSize } = useTheme();

  const { items, loading, refreshing, error, onRefresh, refetch } = useApiList<Invitation>(
    '/invitations',
    { channel: 'invitations' },
  );

  return (
    <>
      <PageHeader title="Invitations" subtitle={`${items.length} sent`} />
      <ListScreen
        items={items}
        loading={loading}
        refreshing={refreshing}
        error={error}
        onRefresh={onRefresh}
        onRetry={() => void refetch()}
        keyExtractor={(i) => i.id}
        header={
          <Banner
            tone="info"
            message="Sending invitations is rank-gated — use the web console, where the role picker enforces who you're allowed to invite."
          />
        }
        emptyTitle="No invitations"
        emptyDescription="People you invite to the workspace appear here until they accept."
        renderItem={({ item }) => {
          const expired = !!item.expires_at && new Date(item.expires_at).getTime() < Date.now();
          return (
            <Card>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md }}>
                <View style={{ flex: 1 }}>
                  <Text
                    numberOfLines={1}
                    style={{ fontSize: fontSize.md, fontWeight: '600', color: colors.ink }}
                  >
                    {item.email}
                  </Text>
                  <Text style={{ fontSize: fontSize.xs, color: colors.faint, marginTop: 4 }}>
                    Sent {relativeDate(item.created_at)}
                    {item.expires_at
                      ? expired
                        ? ' · expired'
                        : ` · expires ${new Date(item.expires_at).toLocaleDateString()}`
                      : ''}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 6 }}>
                  <Pill label={ROLE_LABEL[item.role] ?? item.role} tone="brand" size="sm" />
                  <Pill
                    label={expired ? 'expired' : (item.status ?? 'pending')}
                    tone={statusTone(item.status, item.expires_at)}
                    size="sm"
                  />
                </View>
              </View>
            </Card>
          );
        }}
      />
    </>
  );
}
