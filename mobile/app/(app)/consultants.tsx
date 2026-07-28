import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { ListScreen, PageHeader } from '../../src/components/ui/Screen';
import { Card, DetailRow, Divider, SectionHeader } from '../../src/components/ui/Card';
import { Tabs, type TabItem } from '../../src/components/ui/Tabs';
import { Sheet } from '../../src/components/ui/Sheet';
import { Pill, MARKETING_STATUS_TONE } from '../../src/components/ui/Pill';
import { Avatar } from '../../src/components/ui/Avatar';
import { SearchInput } from '../../src/components/ui/Inputs';
import { RouteGuard } from '../../src/components/RouteGuard';
import { useApiList } from '../../src/hooks/useApi';
import { OPERATOR_TIER, type Consultant } from '../../src/types';
import { useTheme } from '../../src/theme';
import { shortDate } from '../../src/utils/format';

/**
 * Consultant directory — GET /consultants.
 *
 * OPERATOR_TIER. Scoping is applied server-side and is NOT uniform: a RECRUITER
 * sees only their own consultants, a group lead only their group, admin tier
 * sees everything. The client asks the same question for everyone and renders
 * whatever comes back — replicating that scoping here would only risk drifting
 * from it.
 *
 * A marketing-status filter strip mirrors the web bench view; tapping a row opens
 * a read-only detail sheet (contact, work authorization, skills, target roles).
 */
export default function ConsultantsScreen() {
  return (
    <RouteGuard allow={[...OPERATOR_TIER]}>
      <ConsultantsList />
    </RouteGuard>
  );
}

const STATUS_FILTERS = ['ALL', 'ACTIVE', 'PAUSED', 'PLACED', 'DEACTIVATED'] as const;
const titleCase = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

function ConsultantsList() {
  const { colors, spacing, fontSize } = useTheme();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<string>('ALL');
  const [selected, setSelected] = useState<Consultant | null>(null);

  const { items, loading, refreshing, error, onRefresh, refetch } = useApiList<Consultant>(
    '/consultants',
    { channel: 'consultants' },
  );

  const counts = useMemo(() => {
    const map: Record<string, number> = { ALL: items.length };
    for (const c of items)
      if (c.marketing_status) map[c.marketing_status] = (map[c.marketing_status] ?? 0) + 1;
    return map;
  }, [items]);

  const tabs: TabItem[] = STATUS_FILTERS.map((s) => ({
    key: s,
    label: s === 'ALL' ? 'All' : titleCase(s),
    count: counts[s] ?? 0,
  }));

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((c) => {
      if (status !== 'ALL' && c.marketing_status !== status) return false;
      if (!q) return true;
      return (
        c.user?.full_name?.toLowerCase().includes(q) ||
        c.user?.email?.toLowerCase().includes(q) ||
        c.skills?.some((s) => s.toLowerCase().includes(q))
      );
    });
  }, [items, query, status]);

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
          <View style={{ gap: spacing.sm }}>
            <SearchInput value={query} onChangeText={setQuery} placeholder="Search name or skill" />
            <Tabs items={tabs} value={status} onChange={setStatus} />
          </View>
        }
        emptyTitle={query || status !== 'ALL' ? 'No matches' : 'No consultants'}
        emptyDescription={
          query || status !== 'ALL'
            ? 'Try a different name, skill, or status.'
            : 'Consultants assigned to you appear here.'
        }
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

      <ConsultantDetail consultant={selected} onClose={() => setSelected(null)} />
    </>
  );
}

function ConsultantDetail({
  consultant,
  onClose,
}: {
  consultant: Consultant | null;
  onClose: () => void;
}) {
  const { colors, spacing, fontSize } = useTheme();
  if (!consultant) return null;
  const c = consultant;

  return (
    <Sheet open={!!consultant} onClose={onClose} title={c.user?.full_name?.trim() || 'Consultant'}>
      <View style={{ gap: spacing.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <Avatar
            id={c.user?.id ?? c.id}
            name={c.user?.full_name}
            email={c.user?.email}
            uri={c.user?.avatar_url}
            size={52}
          />
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: fontSize.md, fontWeight: '700', color: colors.ink }}>
              {c.user?.full_name?.trim() || c.user?.email || 'Unnamed consultant'}
            </Text>
            {c.marketing_status ? (
              <View style={{ marginTop: 4, alignSelf: 'flex-start' }}>
                <Pill
                  label={c.marketing_status}
                  tone={MARKETING_STATUS_TONE[c.marketing_status] ?? 'neutral'}
                  size="sm"
                />
              </View>
            ) : null}
          </View>
        </View>

        <View>
          <DetailRow label="Email" value={c.user?.email ?? '—'} />
          <Divider />
          <DetailRow label="Work authorization" value={c.visa_status ?? '—'} />
          <Divider />
          <DetailRow label="Onboarded" value={c.onboarded_at ? shortDate(c.onboarded_at) : '—'} />
        </View>

        {c.skills?.length ? (
          <View>
            <SectionHeader title="Skills" />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {c.skills.map((s) => (
                <Pill key={s} label={s} tone="brand" size="sm" />
              ))}
            </View>
          </View>
        ) : null}

        {c.desired_positions?.length ? (
          <View>
            <SectionHeader title="Target roles" />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {c.desired_positions.map((p) => (
                <Pill key={p} label={p} tone="accent" size="sm" />
              ))}
            </View>
          </View>
        ) : null}
      </View>
    </Sheet>
  );
}
