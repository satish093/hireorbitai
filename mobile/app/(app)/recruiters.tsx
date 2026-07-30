import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Screen, ListScreen } from '../../src/components/ui/Screen';
import { PageTopBar } from '../../src/components/ui/TopBar';
import { DetailRow, Divider, SectionHeader } from '../../src/components/ui/Card';
import { Pill, pillToneColor } from '../../src/components/ui/Pill';
import { Sheet } from '../../src/components/ui/Sheet';
import { Avatar } from '../../src/components/ui/Avatar';
import { SearchInput } from '../../src/components/ui/Inputs';
import { RouteGuard } from '../../src/components/RouteGuard';
import { useApiList } from '../../src/hooks/useApi';
import { useGroups } from '../../src/hooks/useGroups';
import { MANAGER_TIER, ROLE_LABEL, type ManagerLink, type Recruiter } from '../../src/types';
import { useTheme } from '../../src/theme';

/** "Reports to" — the recruiter's managers, mirroring the web's effectiveManagers(). */
function effectiveManagers(r: Recruiter): ManagerLink[] {
  const links = (r.managers ?? []).filter((m) => m.manager);
  if (links.length > 0) return links;
  if (r.manager) return [{ is_primary: true, manager: r.manager }];
  return [];
}

/** NUMERIC/BIGINT columns arrive as strings via node-postgres — coerce safely. */
const num = (v: unknown): number | null => {
  const n = Number(v);
  return v == null || Number.isNaN(n) ? null : n;
};

/**
 * Recruiter directory — GET /recruiters.
 *
 * MANAGER_TIER and above. This deliberately excludes RECRUITER: the directory is
 * a management view, and the web hides it from recruiters too. A group lead is
 * further confined to their own group inside the controller.
 */
export default function RecruitersScreen() {
  return (
    <RouteGuard allow={[...MANAGER_TIER]}>
      <RecruitersList />
    </RouteGuard>
  );
}

function RecruitersList() {
  const { colors, spacing, fontSize } = useTheme();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Recruiter | null>(null);

  const { items, loading, refreshing, error, onRefresh, refetch } = useApiList<Recruiter>(
    '/recruiters',
    { channel: 'recruiters' },
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (r) =>
        r.user?.full_name?.toLowerCase().includes(q) ||
        r.user?.email?.toLowerCase().includes(q) ||
        r.team?.toLowerCase().includes(q),
    );
  }, [items, query]);

  return (
    <Screen edges={['top']}>
      <PageTopBar title="Recruiters" subtitle={`${items.length} in your org`} showBack />
      <ListScreen
        items={filtered}
        loading={loading}
        refreshing={refreshing}
        error={error}
        onRefresh={onRefresh}
        onRetry={() => void refetch()}
        keyExtractor={(r) => r.id}
        ItemSeparatorComponent={() => <Divider inset={56} />}
        contentContainerStyle={{
          paddingHorizontal: spacing.lg,
          paddingTop: spacing.sm,
          paddingBottom: spacing['4xl'] + insets.bottom,
          flexGrow: 1,
        }}
        header={
          <View style={{ marginBottom: spacing.xs }}>
            <SearchInput value={query} onChangeText={setQuery} placeholder="Search name or team" />
          </View>
        }
        emptyTitle={query ? 'No matches' : 'No recruiters'}
        renderItem={({ item }) => {
          const active = (item.status ?? '').toUpperCase() === 'ACTIVE';
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
                id={item.user?.id ?? item.id}
                name={item.user?.full_name}
                email={item.user?.email}
                uri={item.user?.avatar_url}
                size={44}
              />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text
                  numberOfLines={1}
                  style={{ fontSize: fontSize.md, fontWeight: '600', color: colors.ink }}
                >
                  {item.user?.full_name?.trim() || item.user?.email || 'Unnamed recruiter'}
                </Text>
                <Text numberOfLines={1} style={{ fontSize: fontSize.sm, color: colors.muted }}>
                  {item.team ?? 'No team set'}
                </Text>
              </View>
              {item.status ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <View
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: 4,
                      backgroundColor: pillToneColor(active ? 'success' : 'neutral', colors),
                    }}
                  />
                  <Text
                    style={{
                      fontSize: fontSize.sm,
                      fontWeight: '600',
                      color: pillToneColor(active ? 'success' : 'neutral', colors),
                    }}
                  >
                    {item.status}
                  </Text>
                </View>
              ) : null}
            </Pressable>
          );
        }}
      />

      <RecruiterDetail recruiter={selected} onClose={() => setSelected(null)} />
    </Screen>
  );
}

/**
 * Read-only recruiter detail — mirrors the web Recruiters table columns
 * (Name · Team · Group · Consultants · Reports to · Weekly target · Status) plus
 * the remaining DB fields (email, notes). "Reports to" and "Group" resolve names
 * client-side the same way the web does.
 */
function RecruiterDetail({
  recruiter,
  onClose,
}: {
  recruiter: Recruiter | null;
  onClose: () => void;
}) {
  const { colors, spacing, fontSize } = useTheme();
  const { groupName } = useGroups();
  if (!recruiter) return null;
  const r = recruiter;

  const managers = effectiveManagers(r);
  const status = r.marketing_status ?? r.status ?? '—';
  const weekly = num(r.target_submissions_per_week);
  const group = groupName(r.user?.group_id);

  return (
    <Sheet open={!!recruiter} onClose={onClose} title={r.user?.full_name?.trim() || 'Recruiter'}>
      <View style={{ gap: spacing.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <Avatar
            id={r.user?.id ?? r.id}
            name={r.user?.full_name}
            email={r.user?.email}
            uri={r.user?.avatar_url}
            size={52}
          />
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: fontSize.md, fontWeight: '700', color: colors.ink }}>
              {r.user?.full_name?.trim() || r.user?.email || 'Unnamed recruiter'}
            </Text>
            {status !== '—' ? (
              <View style={{ marginTop: 4, alignSelf: 'flex-start' }}>
                <Pill label={String(status)} tone="neutral" size="sm" />
              </View>
            ) : null}
          </View>
        </View>

        <View>
          <DetailRow label="Email" value={r.user?.email ?? '—'} />
          <Divider />
          <DetailRow label="Team" value={r.team ?? '—'} />
          <Divider />
          <DetailRow label="Group" value={group ?? '—'} />
          <Divider />
          <DetailRow label="Consultants" value={r.consultant_count ?? 0} />
          <Divider />
          <DetailRow label="Weekly target" value={weekly ?? '—'} />
          <Divider />
          <DetailRow label="Status" value={String(status)} />
        </View>

        <View>
          <SectionHeader title="Reports to" />
          {managers.length === 0 ? (
            <Text style={{ fontSize: fontSize.sm, color: colors.muted }}>
              Not assigned to a manager.
            </Text>
          ) : (
            <View style={{ gap: spacing.sm }}>
              {managers.map((m, i) => (
                <View
                  key={m.manager?.id ?? i}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}
                >
                  <Avatar
                    id={m.manager?.id ?? String(i)}
                    name={m.manager?.full_name}
                    email={m.manager?.email}
                    size={32}
                  />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ fontSize: fontSize.base, color: colors.ink }}>
                      {m.manager?.full_name?.trim() || m.manager?.email || 'Manager'}
                      {m.is_primary ? '  ★' : ''}
                    </Text>
                    {m.manager?.role ? (
                      <Text style={{ fontSize: fontSize.xs, color: colors.faint }}>
                        {ROLE_LABEL[m.manager.role] ?? m.manager.role}
                      </Text>
                    ) : null}
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>

        {r.notes ? (
          <View>
            <SectionHeader title="Notes" />
            <Text style={{ fontSize: fontSize.base, color: colors.ink, lineHeight: 20 }}>
              {r.notes}
            </Text>
          </View>
        ) : null}
      </View>
    </Sheet>
  );
}
