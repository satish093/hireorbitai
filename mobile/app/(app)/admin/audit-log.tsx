import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { ListScreen, PageHeader } from '../../../src/components/ui/Screen';
import { Card } from '../../../src/components/ui/Card';
import { Pill, type PillTone } from '../../../src/components/ui/Pill';
import { Tabs } from '../../../src/components/ui/Tabs';
import { RouteGuard } from '../../../src/components/RouteGuard';
import { useApiList } from '../../../src/hooks/useApi';
import { ADMIN_TIER, type AuditLogEntry } from '../../../src/types';
import { useTheme } from '../../../src/theme';
import { relativeDate } from '../../../src/utils/format';

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

// Domain buckets mirroring the web AdminAuditLog's ACTION_GROUPS, applied
// client-side over the fetched page — a lightweight version of the web's
// server-side action filter, which is enough for the mobile "recent events"
// view.
type Bucket = 'all' | 'auth' | 'users' | 'groups' | 'denied';
const BUCKET_TEST: Record<Exclude<Bucket, 'all'>, (a: string) => boolean> = {
  auth: (a) => /login|logout|password|account_(locked|unlocked)|must_change/.test(a),
  users: (a) => /^admin_(user|role|session)|impersonat|capabilit|page_access/.test(a),
  groups: (a) => /^group_/.test(a),
  denied: (a) => /denied|blocked|failed|invalid/.test(a),
};

function AuditLog() {
  const { colors, spacing, fontSize } = useTheme();
  const [bucket, setBucket] = useState<Bucket>('all');

  const { items, loading, refreshing, error, onRefresh, refetch } = useApiList<AuditLogEntry>(
    '/admin/users/audit',
    { channel: 'users' },
  );

  const counts = useMemo(() => {
    const c = { auth: 0, users: 0, groups: 0, denied: 0 };
    for (const e of items) {
      const a = e.action.toLowerCase();
      if (BUCKET_TEST.auth(a)) c.auth += 1;
      if (BUCKET_TEST.users(a)) c.users += 1;
      if (BUCKET_TEST.groups(a)) c.groups += 1;
      if (BUCKET_TEST.denied(a)) c.denied += 1;
    }
    return c;
  }, [items]);

  const filtered = useMemo(
    () =>
      bucket === 'all' ? items : items.filter((e) => BUCKET_TEST[bucket](e.action.toLowerCase())),
    [items, bucket],
  );

  return (
    <>
      <PageHeader title="Audit log" subtitle={`${items.length} recent events`} />
      <ListScreen
        items={filtered}
        loading={loading}
        refreshing={refreshing}
        error={error}
        onRefresh={onRefresh}
        onRetry={() => void refetch()}
        keyExtractor={(e) => e.id}
        header={
          <Tabs
            value={bucket}
            onChange={(b) => setBucket(b as Bucket)}
            items={[
              { key: 'all', label: 'All', count: items.length },
              { key: 'auth', label: 'Auth', count: counts.auth },
              { key: 'users', label: 'Users', count: counts.users },
              { key: 'groups', label: 'Groups', count: counts.groups },
              { key: 'denied', label: 'Denied', count: counts.denied },
            ]}
          />
        }
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
