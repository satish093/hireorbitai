import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Screen, ListScreen } from '../../src/components/ui/Screen';
import { PageTopBar } from '../../src/components/ui/TopBar';
import { DetailRow, Divider } from '../../src/components/ui/Card';
import { Pill } from '../../src/components/ui/Pill';
import { Sheet } from '../../src/components/ui/Sheet';
import { Avatar } from '../../src/components/ui/Avatar';
import { SearchInput } from '../../src/components/ui/Inputs';
import { RouteGuard } from '../../src/components/RouteGuard';
import { useApiList } from '../../src/hooks/useApi';
import { useGroups } from '../../src/hooks/useGroups';
import { MANAGER_TIER, ROLE_LABEL, type Role, type Manager } from '../../src/types';
import { useTheme } from '../../src/theme';
import { shortDate, relativeDate } from '../../src/utils/format';

/** GET /managers returns the user row plus their group-lead context. */
type ManagerRow = Manager;
const titleCaseStatus = (s?: string | null) =>
  s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : '—';

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
  const insets = useSafeAreaInsets();
  const { groupName } = useGroups();
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
        groupName(m.group_id)?.toLowerCase().includes(q),
    );
  }, [items, query, groupName]);

  return (
    <Screen edges={['top']}>
      <PageTopBar title="Managers" subtitle={`${items.length} leads`} showBack />
      <ListScreen
        items={filtered}
        loading={loading}
        refreshing={refreshing}
        error={error}
        onRefresh={onRefresh}
        onRetry={() => void refetch()}
        keyExtractor={(m) => m.id}
        ItemSeparatorComponent={() => <Divider inset={56} />}
        contentContainerStyle={{
          paddingHorizontal: spacing.lg,
          paddingTop: spacing.sm,
          paddingBottom: spacing['4xl'] + insets.bottom,
          flexGrow: 1,
        }}
        header={
          <View style={{ marginBottom: spacing.xs }}>
            <SearchInput value={query} onChangeText={setQuery} placeholder="Search name or group" />
          </View>
        }
        emptyTitle={query ? 'No matches' : 'No managers'}
        renderItem={({ item }) => {
          const meta =
            groupName(item.group_id) ??
            (typeof item.recruiter_count === 'number'
              ? `${item.recruiter_count} recruiter${item.recruiter_count === 1 ? '' : 's'}`
              : 'No group assigned');
          return (
            <Pressable
              onPress={() => setSelected(item)}
              accessibilityRole="button"
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.md,
                paddingVertical: 12,
                backgroundColor: pressed ? colors.hover : 'transparent',
              })}
            >
              <Avatar
                id={item.id}
                name={item.full_name}
                email={item.email}
                uri={item.avatar_url}
                size={44}
              />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text
                  numberOfLines={1}
                  style={{ fontSize: fontSize.md, fontWeight: '600', color: colors.ink }}
                >
                  {item.full_name?.trim() || item.email}
                </Text>
                <Text numberOfLines={1} style={{ fontSize: fontSize.sm, color: colors.muted }}>
                  {meta}
                </Text>
              </View>
              {item.role ? (
                <Pill label={ROLE_LABEL[item.role as Role] ?? item.role} tone="brand" size="sm" />
              ) : null}
            </Pressable>
          );
        }}
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
              <DetailRow
                label="Role"
                value={selected.role ? (ROLE_LABEL[selected.role as Role] ?? selected.role) : '—'}
              />
              <Divider />
              <DetailRow label="Group" value={groupName(selected.group_id) ?? '—'} />
              <Divider />
              <DetailRow
                label="Recruiters"
                value={
                  typeof selected.recruiter_count === 'number' ? selected.recruiter_count : '—'
                }
              />
              <Divider />
              <DetailRow label="Status" value={titleCaseStatus(selected.status)} />
              <Divider />
              <DetailRow
                label="Last login"
                value={selected.last_login_at ? relativeDate(selected.last_login_at) : 'Never'}
              />
              <Divider />
              <DetailRow
                label="Joined"
                value={selected.created_at ? shortDate(selected.created_at) : '—'}
              />
            </View>
          </View>
        ) : null}
      </Sheet>
    </Screen>
  );
}
