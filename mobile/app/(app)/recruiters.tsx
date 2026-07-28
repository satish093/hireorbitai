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
    <>
      <PageHeader title="Recruiters" subtitle={`${items.length} in your org`} />
      <ListScreen
        items={filtered}
        loading={loading}
        refreshing={refreshing}
        error={error}
        onRefresh={onRefresh}
        onRetry={() => void refetch()}
        keyExtractor={(r) => r.id}
        header={
          <SearchInput value={query} onChangeText={setQuery} placeholder="Search name or team" />
        }
        emptyTitle={query ? 'No matches' : 'No recruiters'}
        renderItem={({ item }) => (
          <Card onPress={() => setSelected(item)}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
              <Avatar
                id={item.user?.id ?? item.id}
                name={item.user?.full_name}
                email={item.user?.email}
                uri={item.user?.avatar_url}
                size={44}
              />
              <View style={{ flex: 1 }}>
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
              {item.status ? <Pill label={item.status} tone="neutral" size="sm" /> : null}
            </View>
          </Card>
        )}
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
    </>
  );
}
