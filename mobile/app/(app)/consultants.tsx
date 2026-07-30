import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Screen, ListScreen, Banner } from '../../src/components/ui/Screen';
import { PageTopBar } from '../../src/components/ui/TopBar';
import { DetailRow, Divider, SectionHeader } from '../../src/components/ui/Card';
import { Tabs, type TabItem } from '../../src/components/ui/Tabs';
import { Sheet } from '../../src/components/ui/Sheet';
import { Pill, MARKETING_STATUS_TONE, pillToneColor } from '../../src/components/ui/Pill';
import { Avatar } from '../../src/components/ui/Avatar';
import { SearchInput, SelectInput } from '../../src/components/ui/Inputs';
import { Button } from '../../src/components/ui/Button';
import { RouteGuard } from '../../src/components/RouteGuard';
import { useApiList, useApiMutation } from '../../src/hooks/useApi';
import { useGroups } from '../../src/hooks/useGroups';
import { useAuth } from '../../src/context/AuthContext';
import {
  OPERATOR_TIER,
  MANAGER_TIER,
  ADMIN_TIER,
  ROLE_LABEL,
  assignableRolesFor,
  type Role,
  type Consultant,
  type Recruiter,
} from '../../src/types';
import { useTheme } from '../../src/theme';
import { shortDate } from '../../src/utils/format';

/** NUMERIC/BIGINT columns arrive as strings via node-postgres — coerce safely. */
const num = (v: unknown): number | null => {
  const n = Number(v);
  return v == null || Number.isNaN(n) ? null : n;
};

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
  const insets = useSafeAreaInsets();
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
    <Screen edges={['top']}>
      <PageTopBar title="Consultants" subtitle={`${items.length} on your bench`} showBack />
      <ListScreen
        items={filtered}
        loading={loading}
        refreshing={refreshing}
        error={error}
        onRefresh={onRefresh}
        onRetry={() => void refetch()}
        keyExtractor={(c) => c.id}
        ItemSeparatorComponent={() => <Divider inset={56} />}
        contentContainerStyle={{
          paddingHorizontal: spacing.lg,
          paddingTop: spacing.sm,
          paddingBottom: spacing['4xl'] + insets.bottom,
          flexGrow: 1,
        }}
        header={
          <View style={{ gap: spacing.sm, marginBottom: spacing.xs }}>
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
        renderItem={({ item }) => {
          const meta = item.skills?.length
            ? item.skills.slice(0, 3).join(' · ')
            : (item.visa_status ?? 'Work authorization not set');
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
                  {item.user?.full_name?.trim() || item.user?.email || 'Unnamed consultant'}
                </Text>
                <Text numberOfLines={1} style={{ fontSize: fontSize.sm, color: colors.muted }}>
                  {meta}
                </Text>
              </View>
              {item.marketing_status ? (
                <StatusText
                  label={titleCase(item.marketing_status)}
                  color={pillToneColor(
                    MARKETING_STATUS_TONE[item.marketing_status] ?? 'neutral',
                    colors,
                  )}
                />
              ) : null}
            </Pressable>
          );
        }}
      />

      <ConsultantDetail
        consultant={selected}
        onClose={() => setSelected(null)}
        onChanged={() => void refetch()}
      />
    </Screen>
  );
}

/** Inline status = a small colored dot + colored text (the website's row status). */
function StatusText({ label, color }: { label: string; color: string }) {
  const { fontSize } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: color }} />
      <Text style={{ fontSize: fontSize.sm, fontWeight: '600', color }}>{label}</Text>
    </View>
  );
}

function ConsultantDetail({
  consultant,
  onClose,
  onChanged,
}: {
  consultant: Consultant | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { colors, spacing, fontSize } = useTheme();
  const { profile } = useAuth();
  const { groupName, options: groupOptions } = useGroups();

  const canManage = !!profile && (MANAGER_TIER as readonly string[]).includes(profile.role);
  const canChangeRole = !!profile && (ADMIN_TIER as readonly string[]).includes(profile.role);

  // Recruiters power the "assign recruiter in the selected group" picker. Only
  // manager-tier can read /recruiters, so gate the fetch to avoid a 403 for a
  // plain RECRUITER viewing the directory.
  const recruiters = useApiList<Recruiter>('/recruiters', {
    channel: 'recruiters',
    enabled: canManage,
  });

  if (!consultant) return null;
  const c = consultant;

  const experience = num(c.total_experience_years);
  const rate = num(c.expected_rate);

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
          <DetailRow label="Phone" value={c.user?.phone ?? '—'} />
          <Divider />
          <DetailRow
            label="Role"
            value={c.user?.role ? (ROLE_LABEL[c.user.role] ?? c.user.role) : '—'}
          />
          <Divider />
          <DetailRow label="Group" value={groupName(c.user?.group_id) ?? '—'} />
          <Divider />
          <DetailRow
            label="Recruiter"
            value={
              c.recruiter?.user?.full_name?.trim() ||
              c.recruiter?.user?.email ||
              (c.recruiter?.team ? c.recruiter.team : 'Unassigned')
            }
          />
          <Divider />
          <DetailRow label="Primary skill" value={c.primary_skill ?? '—'} />
          <Divider />
          <DetailRow label="Work authorization" value={c.visa_status ?? '—'} />
          <Divider />
          <DetailRow label="Experience" value={experience != null ? `${experience} yrs` : '—'} />
          <Divider />
          <DetailRow label="Location" value={c.current_location ?? '—'} />
          <Divider />
          <DetailRow label="Expected rate" value={rate != null ? `$${rate}/hr` : '—'} />
          <Divider />
          <DetailRow
            label="Open to relocate"
            value={c.relocation == null ? '—' : c.relocation ? 'Yes' : 'No'}
          />
          <Divider />
          <DetailRow
            label="Remote only"
            value={c.remote_only == null ? '—' : c.remote_only ? 'Yes' : 'No'}
          />
          <Divider />
          <DetailRow label="Onboarded" value={c.onboarded_at ? shortDate(c.onboarded_at) : '—'} />
        </View>

        {c.linkedin_url || c.github_url || c.portfolio_url ? (
          <View>
            <SectionHeader title="Links" />
            {c.linkedin_url ? (
              <DetailRow label="LinkedIn" value={c.linkedin_url} tone="muted" />
            ) : null}
            {c.github_url ? <DetailRow label="GitHub" value={c.github_url} tone="muted" /> : null}
            {c.portfolio_url ? (
              <DetailRow label="Portfolio" value={c.portfolio_url} tone="muted" />
            ) : null}
          </View>
        ) : null}

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

        {c.preferred_locations?.length ? (
          <View>
            <SectionHeader title="Preferred locations" />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {c.preferred_locations.map((p) => (
                <Pill key={p} label={p} tone="neutral" size="sm" />
              ))}
            </View>
          </View>
        ) : null}

        {c.notes ? (
          <View>
            <SectionHeader title="Notes" />
            <Text style={{ fontSize: fontSize.base, color: colors.ink, lineHeight: 20 }}>
              {c.notes}
            </Text>
          </View>
        ) : null}

        {canManage || canChangeRole ? (
          <ConsultantActions
            consultant={c}
            recruiters={recruiters.items}
            groupOptions={groupOptions}
            canManage={canManage}
            canChangeRole={canChangeRole}
            onDone={() => {
              onChanged();
              onClose();
            }}
          />
        ) : null}
      </View>
    </Sheet>
  );
}

/**
 * Admin actions on a consultant — change role, and move them to another group
 * while assigning a recruiter in that group. Every endpoint here already exists
 * and enforces its own rank/ownership guards server-side:
 *   - PATCH /admin/users/:userId/role         (ADMIN_TIER)
 *   - POST  /consultants/:id/move-group        (MANAGER_TIER; recruiter must be
 *                                               in the target group)
 * The recruiter picker is scoped to the chosen group, mirroring the web.
 */
function ConsultantActions({
  consultant,
  recruiters,
  groupOptions,
  canManage,
  canChangeRole,
  onDone,
}: {
  consultant: Consultant;
  recruiters: Recruiter[];
  groupOptions: (includeNone?: boolean) => { value: string; label: string }[];
  canManage: boolean;
  canChangeRole: boolean;
  onDone: () => void;
}) {
  const { profile } = useAuth();
  const { spacing } = useTheme();
  const c = consultant;

  // Role change
  const [role, setRole] = useState<Role | ''>('');
  const changeRole = useApiMutation<{ role: Role }>('patch', '/admin/users', {
    invalidates: ['consultants', 'users'],
  });

  // Move group + assign recruiter in that group
  const [groupId, setGroupId] = useState<string>(c.user?.group_id ?? '');
  const [recruiterId, setRecruiterId] = useState<string>(c.recruiter_id ?? '');
  const moveGroup = useApiMutation<{ group_id: string | null; recruiter_id: string | null }>(
    'post',
    '/consultants',
    { invalidates: ['consultants'] },
  );

  const roleOptions = useMemo(
    () =>
      (profile ? assignableRolesFor(profile.role) : []).map((r) => ({
        value: r,
        label: ROLE_LABEL[r] ?? r,
      })),
    [profile],
  );

  // Recruiters available in the selected group (a recruiter's group lives on
  // their user row). Moving OUT of a group (Unassigned) needs no recruiter.
  const recruiterOptions = useMemo(
    () =>
      recruiters
        .filter((r) => (groupId ? r.user?.group_id === groupId : false))
        .map((r) => ({
          value: r.id,
          label: r.user?.full_name?.trim() || r.user?.email || r.team || 'Recruiter',
        })),
    [recruiters, groupId],
  );

  const submitRole = async () => {
    if (!role || !c.user?.id) return;
    const ok = await changeRole.mutate({ role }, `/admin/users/${c.user.id}/role`);
    if (ok) onDone();
  };

  const submitMove = async () => {
    if (!c.id) return;
    // Backend requires a recruiter in the target group when moving into a group.
    if (groupId && !recruiterId) return;
    const ok = await moveGroup.mutate(
      { group_id: groupId || null, recruiter_id: groupId ? recruiterId || null : null },
      `/consultants/${c.id}/move-group`,
    );
    if (ok) onDone();
  };

  return (
    <View style={{ gap: spacing.md }}>
      <Divider />
      <SectionHeader title="Manage" />

      {canChangeRole ? (
        <View style={{ gap: spacing.sm }}>
          <SelectInput
            label="Change role"
            value={role || null}
            options={roleOptions}
            onChange={(v) => setRole(v as Role)}
            placeholder="Pick a new role"
          />
          {changeRole.error ? <Banner tone="danger" message={changeRole.error} /> : null}
          <Button
            label={changeRole.pending ? 'Updating…' : 'Update role'}
            variant="secondary"
            onPress={submitRole}
            loading={changeRole.pending}
            disabled={!role || changeRole.pending}
          />
        </View>
      ) : null}

      {canManage ? (
        <View style={{ gap: spacing.sm }}>
          <SelectInput
            label="Move to group"
            value={groupId || null}
            options={groupOptions(true)}
            onChange={(v) => {
              setGroupId(v);
              setRecruiterId('');
            }}
            placeholder="Pick a group"
          />
          {groupId ? (
            <SelectInput
              label="Recruiter in this group"
              value={recruiterId || null}
              options={recruiterOptions}
              onChange={setRecruiterId}
              placeholder={
                recruiterOptions.length ? 'Pick a recruiter' : 'No recruiters in this group'
              }
              hint="Required — the consultant is assigned to this recruiter."
            />
          ) : null}
          {moveGroup.error ? <Banner tone="danger" message={moveGroup.error} /> : null}
          <Button
            label={moveGroup.pending ? 'Saving…' : 'Move group & assign'}
            onPress={submitMove}
            loading={moveGroup.pending}
            disabled={moveGroup.pending || (!!groupId && !recruiterId)}
          />
        </View>
      ) : null}
    </View>
  );
}
