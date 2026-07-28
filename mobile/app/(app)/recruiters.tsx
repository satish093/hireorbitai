import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Screen, ListScreen } from '../../src/components/ui/Screen';
import { PageTopBar } from '../../src/components/ui/TopBar';
import { DetailRow, Divider } from '../../src/components/ui/Card';
import { Pill, pillToneColor } from '../../src/components/ui/Pill';
import { Sheet } from '../../src/components/ui/Sheet';
import { Avatar } from '../../src/components/ui/Avatar';
import { SearchInput } from '../../src/components/ui/Inputs';
import { RouteGuard } from '../../src/components/RouteGuard';
import { useApiList } from '../../src/hooks/useApi';
import { MANAGER_TIER, type Recruiter } from '../../src/types';
import { useTheme } from '../../src/theme';

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

      <Sheet
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.user?.full_name?.trim() || 'Recruiter'}
      >
        {selected ? (
          <View style={{ gap: spacing.md }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
              <Avatar
                id={selected.user?.id ?? selected.id}
                name={selected.user?.full_name}
                email={selected.user?.email}
                uri={selected.user?.avatar_url}
                size={52}
              />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: fontSize.md, fontWeight: '700', color: colors.ink }}>
                  {selected.user?.full_name?.trim() || selected.user?.email || 'Unnamed recruiter'}
                </Text>
                {selected.status ? (
                  <View style={{ marginTop: 4, alignSelf: 'flex-start' }}>
                    <Pill label={selected.status} tone="neutral" size="sm" />
                  </View>
                ) : null}
              </View>
            </View>
            <View>
              <DetailRow label="Email" value={selected.user?.email ?? '—'} />
              <Divider />
              <DetailRow label="Team" value={selected.team ?? '—'} />
            </View>
          </View>
        ) : null}
      </Sheet>
    </Screen>
  );
}
