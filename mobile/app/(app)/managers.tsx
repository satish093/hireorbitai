import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { ListScreen, PageHeader } from '../../src/components/ui/Screen';
import { Card, DetailRow, Divider } from '../../src/components/ui/Card';
import { Pill } from '../../src/components/ui/Pill';
import { Sheet } from '../../src/components/ui/Sheet';
import { Avatar } from '../../src/components/ui/Avatar';
import { SearchInput } from '../../src/components/ui/Inputs';
import { RouteGuard } from '../../src/components/RouteGuard';
import { useApiList } from '../../src/hooks/useApi';
import { MANAGER_TIER, ROLE_LABEL, type Role, type UserRef } from '../../src/types';
import { useTheme } from '../../src/theme';

/** GET /managers returns the user row plus their group-lead context. */
interface ManagerRow extends UserRef {
  group_name?: string | null;
  recruiter_count?: number | null;
}

/**
 * Manager directory — GET /managers. MANAGER_TIER and above.
 *
 * HR_MANAGER and MANAGER are functionally one "group lead" tier: each is
 * assigned to ONE group and sees only that group's people, while DIRECTOR and
 * above oversee every group. The role pill makes which is which visible, since
 * the distinction drives what a person can actually reach.
 */
export default function ManagersScreen() {
  return (
    <RouteGuard allow={[...MANAGER_TIER]}>
      <ManagersList />
    </RouteGuard>
  );
}

function ManagersList() {
  const { colors, spacing, fontSize } = useTheme();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<ManagerRow | null>(null);

  const { items, loading, refreshing, error, onRefresh, refetch } = useApiList<ManagerRow>(
    '/managers',
    { channel: 'managers' },
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (m) =>
        m.full_name?.toLowerCase().includes(q) ||
        m.email?.toLowerCase().includes(q) ||
        m.group_name?.toLowerCase().includes(q),
    );
  }, [items, query]);

  return (
    <>
      <PageHeader title="Managers" subtitle={`${items.length} leads`} />
      <ListScreen
        items={filtered}
        loading={loading}
        refreshing={refreshing}
        error={error}
        onRefresh={onRefresh}
        onRetry={() => void refetch()}
        keyExtractor={(m) => m.id}
        header={
          <SearchInput value={query} onChangeText={setQuery} placeholder="Search name or group" />
        }
        emptyTitle={query ? 'No matches' : 'No managers'}
        renderItem={({ item }) => (
          <Card onPress={() => setSelected(item)}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
              <Avatar
                id={item.id}
                name={item.full_name}
                email={item.email}
                uri={item.avatar_url}
                size={44}
              />
              <View style={{ flex: 1 }}>
                <Text
                  numberOfLines={1}
                  style={{ fontSize: fontSize.md, fontWeight: '600', color: colors.ink }}
                >
                  {item.full_name?.trim() || item.email}
                </Text>
                <Text numberOfLines={1} style={{ fontSize: fontSize.sm, color: colors.muted }}>
                  {item.group_name ?? 'No group assigned'}
                </Text>
              </View>
              {item.role ? (
                <Pill label={ROLE_LABEL[item.role as Role] ?? item.role} tone="brand" size="sm" />
              ) : null}
            </View>

            {typeof item.recruiter_count === 'number' ? (
              <Text style={{ fontSize: fontSize.xs, color: colors.faint, marginTop: spacing.sm }}>
                {item.recruiter_count} recruiter{item.recruiter_count === 1 ? '' : 's'}
              </Text>
            ) : null}
          </Card>
        )}
      />

      <Sheet
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.full_name?.trim() || 'Manager'}
      >
        {selected ? (
          <View style={{ gap: spacing.md }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
              <Avatar
                id={selected.id}
                name={selected.full_name}
                email={selected.email}
                uri={selected.avatar_url}
                size={52}
              />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: fontSize.md, fontWeight: '700', color: colors.ink }}>
                  {selected.full_name?.trim() || selected.email}
                </Text>
                {selected.role ? (
                  <View style={{ marginTop: 4, alignSelf: 'flex-start' }}>
                    <Pill
                      label={ROLE_LABEL[selected.role as Role] ?? selected.role}
                      tone="brand"
                      size="sm"
                    />
                  </View>
                ) : null}
              </View>
            </View>
            <View>
              <DetailRow label="Email" value={selected.email ?? '—'} />
              <Divider />
              <DetailRow label="Group" value={selected.group_name ?? '—'} />
              <Divider />
              <DetailRow
                label="Recruiters"
                value={
                  typeof selected.recruiter_count === 'number' ? selected.recruiter_count : '—'
                }
              />
            </View>
          </View>
        ) : null}
      </Sheet>
    </>
  );
}
