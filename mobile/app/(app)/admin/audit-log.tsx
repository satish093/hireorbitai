import { Text, View } from 'react-native';
import { ListScreen, PageHeader } from '../../../src/components/ui/Screen';
import { Card } from '../../../src/components/ui/Card';
import { Pill, type PillTone } from '../../../src/components/ui/Pill';
import { RouteGuard } from '../../../src/components/RouteGuard';
import { useApiList } from '../../../src/hooks/useApi';
import { ADMIN_TIER, type AuditLogEntry } from '../../../src/types';
import { useTheme } from '../../../src/theme';
import { relativeDate } from '../jobs';

/**
 * Security audit trail — GET /admin/users/audit.
 *
 * The AuditAction union in backend/src/services/audit.service.ts is
 * intentionally CLOSED, so the set of verbs here is finite and known. Rather
 * than colour every action individually, actions are bucketed by what they mean:
 * a denial or a lockout should be visually obvious while scrolling, because
 * that is what anyone opens an audit log to find.
 */
export default function AuditLogScreen() {
  return (
    <RouteGuard allow={[...ADMIN_TIER]}>
      <AuditLog />
    </RouteGuard>
  );
}

/** Bucket an action verb into a severity tone. */
function toneFor(action: string): PillTone {
  const a = action.toLowerCase();
  if (/(denied|failed|lock|ban|revoke|delete|suspend)/.test(a)) return 'danger';
  if (/(deactivate|reset|force|impersonate|change)/.test(a)) return 'warn';
  if (/(login|create|activate|invite|grant)/.test(a)) return 'success';
  return 'neutral';
}

function AuditLog() {
  const { colors, spacing, fontSize } = useTheme();

  const { items, loading, refreshing, error, onRefresh, refetch } = useApiList<AuditLogEntry>(
    '/admin/users/audit',
    { channel: 'users' },
  );

  return (
    <>
      <PageHeader title="Audit log" subtitle={`${items.length} recent events`} />
      <ListScreen
        items={items}
        loading={loading}
        refreshing={refreshing}
        error={error}
        onRefresh={onRefresh}
        onRetry={() => void refetch()}
        keyExtractor={(e) => e.id}
        emptyTitle="No audit events"
        emptyDescription="Security-relevant actions are recorded here."
        renderItem={({ item }) => (
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: fontSize.base, fontWeight: '600', color: colors.ink }}>
                  {item.action.replace(/_/g, ' ').toLowerCase()}
                </Text>
                {item.email ? (
                  <Text
                    numberOfLines={1}
                    style={{ fontSize: fontSize.sm, color: colors.ink2, marginTop: 2 }}
                  >
                    {item.email}
                  </Text>
                ) : null}
                <Text style={{ fontSize: fontSize.xs, color: colors.faint, marginTop: 4 }}>
                  {relativeDate(item.created_at)}
                  {item.ip_address ? ` · ${item.ip_address}` : ''}
                </Text>
              </View>
              <Pill
                label={toneFor(item.action).toUpperCase()}
                tone={toneFor(item.action)}
                size="sm"
              />
            </View>

            {item.metadata && Object.keys(item.metadata).length > 0 ? (
              <Text
                numberOfLines={3}
                style={{
                  fontSize: fontSize.xs,
                  color: colors.muted,
                  marginTop: spacing.sm,
                  fontFamily: 'monospace',
                }}
              >
                {JSON.stringify(item.metadata)}
              </Text>
            ) : null}
          </Card>
        )}
      />
    </>
  );
}
