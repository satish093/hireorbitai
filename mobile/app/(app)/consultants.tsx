import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { ListScreen, PageHeader } from '../../src/components/ui/Screen';
import { Card } from '../../src/components/ui/Card';
import { Pill, MARKETING_STATUS_TONE } from '../../src/components/ui/Pill';
import { Avatar } from '../../src/components/ui/Avatar';
import { SearchInput } from '../../src/components/ui/Inputs';
import { RouteGuard } from '../../src/components/RouteGuard';
import { useApiList } from '../../src/hooks/useApi';
import { OPERATOR_TIER, type Consultant } from '../../src/types';
import { useTheme } from '../../src/theme';

/**
 * Consultant directory — GET /consultants.
 *
 * OPERATOR_TIER. Scoping is applied server-side and is NOT uniform: a RECRUITER
 * sees only their own consultants, a group lead only their group, admin tier
 * sees everything. The client asks the same question for everyone and renders
 * whatever comes back — replicating that scoping here would only risk drifting
 * from it.
 */
export default function ConsultantsScreen() {
  return (
    <RouteGuard allow={[...OPERATOR_TIER]}>
      <ConsultantsList />
    </RouteGuard>
  );
}

function ConsultantsList() {
  const { colors, spacing, fontSize } = useTheme();
  const [query, setQuery] = useState('');

  const { items, loading, refreshing, error, onRefresh, refetch } = useApiList<Consultant>(
    '/consultants',
    { channel: 'consultants' },
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (c) =>
        c.user?.full_name?.toLowerCase().includes(q) ||
        c.user?.email?.toLowerCase().includes(q) ||
        c.skills?.some((s) => s.toLowerCase().includes(q)),
    );
  }, [items, query]);

  return (
    <>
      <PageHeader title="Consultants" subtitle={`${items.length} on your bench`} />
      <ListScreen
        items={filtered}
        loading={loading}
        refreshing={refreshing}
        error={error}
        onRefresh={onRefresh}
        onRetry={() => void refetch()}
        keyExtractor={(c) => c.id}
        header={
          <SearchInput value={query} onChangeText={setQuery} placeholder="Search name or skill" />
        }
        emptyTitle={query ? 'No matches' : 'No consultants'}
        emptyDescription={
          query ? 'Try a different name or skill.' : 'Consultants assigned to you appear here.'
        }
        renderItem={({ item }) => (
          <Card>
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
                  {item.user?.full_name?.trim() || item.user?.email || 'Unnamed consultant'}
                </Text>
                <Text numberOfLines={1} style={{ fontSize: fontSize.sm, color: colors.muted }}>
                  {item.visa_status ?? 'Work authorization not set'}
                </Text>
              </View>
              {item.marketing_status ? (
                <Pill
                  label={item.marketing_status}
                  tone={MARKETING_STATUS_TONE[item.marketing_status] ?? 'neutral'}
                  size="sm"
                />
              ) : null}
            </View>

            {item.skills?.length ? (
              <View
                style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.md }}
              >
                {item.skills.slice(0, 6).map((s) => (
                  <Pill key={s} label={s} tone="brand" size="sm" />
                ))}
                {item.skills.length > 6 ? (
                  <Text style={{ fontSize: fontSize.xs, color: colors.faint, alignSelf: 'center' }}>
                    +{item.skills.length - 6} more
                  </Text>
                ) : null}
              </View>
            ) : null}
          </Card>
        )}
      />
    </>
  );
}
