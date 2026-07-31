import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { Screen, ListScreen, Banner } from '../../src/components/ui/Screen';
import { PageTopBar } from '../../src/components/ui/TopBar';
import { Divider } from '../../src/components/ui/Card';
import { pillToneColor, type PillTone } from '../../src/components/ui/Pill';
import { Button } from '../../src/components/ui/Button';
import { Tabs } from '../../src/components/ui/Tabs';
import { Sheet, ConfirmSheet } from '../../src/components/ui/Sheet';
import { FormInput, SelectInput } from '../../src/components/ui/Inputs';
import { RouteGuard } from '../../src/components/RouteGuard';
import { useApiList } from '../../src/hooks/useApi';
import { invalidate } from '../../src/hooks/useInvalidate';
import { api, apiErrorMessage } from '../../src/services/api';
import { useAuth } from '../../src/context/AuthContext';
import {
  OPERATOR_TIER,
  ROLE_LABEL,
  assignableRolesFor,
  type Invitation,
  type Role,
} from '../../src/types';
import { useTheme } from '../../src/theme';
import { relativeDate } from '../../src/utils/format';

/**
 * Invitations — GET /invitations.
 *
 * OPERATOR_TIER, or a DEVELOPER with the `invitations` capability.
 *
 * Invite (+ Invite) — POST /invitations { email, role }. The role picker only
 * offers assignableRolesFor(myRole), the SAME rank rule the backend enforces
 * (canAssignRole: strictly below the inviter's rank; only a SUPER_ADMIN may mint
 * a SUPER_ADMIN or DEVELOPER), so a mis-tap can't request a role the server would
 * reject. The hierarchy parent is auto-resolved server-side from the inviter, so
 * the client sends only email + role.
 *
 * Per-invite follow-ups, same OPERATOR_TIER/capability gate:
 *   • Copy link — the accept URL the server surfaces for PENDING invitations
 *     (invitations.controller list, `invite_url`), for when the email bounced.
 *   • Revoke  — POST /invitations/:id/revoke. Irreversible, so it confirms.
 * There is deliberately NO "Resend" — the backend exposes no such route.
 */
export default function InvitationsScreen() {
  return (
    <RouteGuard allow={[...OPERATOR_TIER]} capability="invitations">
      <InvitationsList />
    </RouteGuard>
  );
}

interface InvitationRow extends Invitation {
  invite_url?: string | null;
}

function isExpired(inv: InvitationRow): boolean {
  return !!inv.expires_at && new Date(inv.expires_at).getTime() < Date.now();
}

/** Normalise to one of the tab buckets. */
function bucketOf(inv: InvitationRow): 'pending' | 'accepted' | 'expired' | 'revoked' {
  const s = (inv.status ?? 'pending').toLowerCase();
  if (s.includes('accept')) return 'accepted';
  if (s.includes('revok')) return 'revoked';
  if (s.includes('expir') || isExpired(inv)) return 'expired';
  return 'pending';
}

function statusTone(inv: InvitationRow): PillTone {
  switch (bucketOf(inv)) {
    case 'accepted':
      return 'success';
    case 'revoked':
      return 'danger';
    case 'expired':
      return 'warn';
    default:
      return 'info';
  }
}

function InvitationsList() {
  const { colors, spacing, fontSize } = useTheme();
  const insets = useSafeAreaInsets();
  const { profile } = useAuth();
  const [tab, setTab] = useState<'all' | 'pending' | 'accepted' | 'expired' | 'revoked'>('all');
  const [confirm, setConfirm] = useState<InvitationRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Roles the signed-in user is actually allowed to invite — same rule the
  // backend enforces (canAssignRole): strictly below their rank, and only a
  // SUPER_ADMIN can mint a SUPER_ADMIN or DEVELOPER. The picker shows only these,
  // so a mis-tap can't produce a role the server would 403.
  const invitableRoles = useMemo<Role[]>(
    () => (profile?.role ? assignableRolesFor(profile.role) : []),
    [profile?.role],
  );

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Role | null>(null);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const {
    items,
    loading,
    refreshing,
    error: loadError,
    onRefresh,
    refetch,
  } = useApiList<InvitationRow>('/invitations', { channel: 'invitations' });

  const counts = useMemo(() => {
    const c = { pending: 0, accepted: 0, expired: 0, revoked: 0 };
    for (const inv of items) c[bucketOf(inv)] += 1;
    return c;
  }, [items]);

  const filtered = useMemo(
    () => (tab === 'all' ? items : items.filter((inv) => bucketOf(inv) === tab)),
    [items, tab],
  );

  const copyLink = async (url: string) => {
    try {
      await Clipboard.setStringAsync(url);
      setError(null);
      setNotice('Invite link copied to clipboard.');
      setTimeout(() => setNotice(null), 2500);
    } catch {
      setNotice(null);
      setError('Could not copy the invite link.');
    }
  };

  const revoke = async (inv: InvitationRow) => {
    setBusyId(inv.id);
    setError(null);
    try {
      await api.post(`/invitations/${inv.id}/revoke`);
      setConfirm(null);
      invalidate('invitations');
      await refetch();
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not revoke this invitation.'));
    } finally {
      setBusyId(null);
    }
  };

  const openInvite = () => {
    setInviteEmail('');
    setInviteRole(
      invitableRoles.includes('CONSULTANT') ? 'CONSULTANT' : (invitableRoles[0] ?? null),
    );
    setInviteError(null);
    setInviteOpen(true);
  };

  const sendInvite = async () => {
    const email = inviteEmail.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setInviteError('Enter a valid email address.');
      return;
    }
    if (!inviteRole) {
      setInviteError('Pick a role for this person.');
      return;
    }
    setInviteBusy(true);
    setInviteError(null);
    try {
      // Server auto-resolves the hierarchy parent from the inviter — the client
      // only sends email + role (POST /invitations, gated the same as this list).
      await api.post('/invitations', { email, role: inviteRole });
      setInviteOpen(false);
      invalidate('invitations');
      await refetch();
      setError(null);
      setNotice(`Invitation sent to ${email}.`);
      setTimeout(() => setNotice(null), 3000);
    } catch (err) {
      setInviteError(apiErrorMessage(err, 'Could not send this invitation.'));
    } finally {
      setInviteBusy(false);
    }
  };

  return (
    <Screen edges={['top']}>
      <PageTopBar
        title="Invitations"
        subtitle="Send role-scoped invites by email."
        showBack
        right={
          invitableRoles.length > 0 ? (
            <Pressable
              onPress={openInvite}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Invite user"
              style={{ height: 36, paddingHorizontal: spacing.sm, justifyContent: 'center' }}
            >
              <Text style={{ color: colors.accent, fontSize: fontSize.md, fontWeight: '700' }}>
                + Invite user
              </Text>
            </Pressable>
          ) : null
        }
      />
      <ListScreen
        items={filtered}
        loading={loading}
        refreshing={refreshing}
        error={loadError}
        onRefresh={onRefresh}
        onRetry={() => void refetch()}
        keyExtractor={(i) => i.id}
        ItemSeparatorComponent={() => <Divider />}
        contentContainerStyle={{
          paddingHorizontal: spacing.lg,
          paddingTop: spacing.sm,
          paddingBottom: spacing['4xl'] + insets.bottom,
          flexGrow: 1,
        }}
        header={
          <View style={{ gap: spacing.md, marginBottom: spacing.xs }}>
            {error ? <Banner tone="danger" message={error} /> : null}
            {notice ? <Banner tone="success" message={notice} /> : null}
            <Tabs
              value={tab}
              onChange={(k) => setTab(k as typeof tab)}
              items={[
                { key: 'all', label: 'All', count: items.length },
                { key: 'pending', label: 'Pending', count: counts.pending },
                { key: 'accepted', label: 'Accepted', count: counts.accepted },
                { key: 'expired', label: 'Expired', count: counts.expired },
                { key: 'revoked', label: 'Revoked', count: counts.revoked },
              ]}
            />
          </View>
        }
        emptyTitle="No invitations"
        emptyDescription="People you invite to the workspace appear here until they accept."
        renderItem={({ item }) => {
          const bucket = bucketOf(item);
          const expired = bucket === 'expired';
          const pending = bucket === 'pending';
          const meta = [
            `Sent ${relativeDate(item.created_at)}`,
            ROLE_LABEL[item.role] ?? item.role,
            item.expires_at
              ? expired
                ? 'expired'
                : `expires ${new Date(item.expires_at).toLocaleDateString()}`
              : null,
          ]
            .filter(Boolean)
            .join(' · ');
          return (
            <View style={{ paddingVertical: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text
                    numberOfLines={1}
                    style={{ fontSize: fontSize.md, fontWeight: '600', color: colors.ink }}
                  >
                    {item.email}
                  </Text>
                  <Text numberOfLines={2} style={{ fontSize: fontSize.sm, color: colors.muted }}>
                    {meta}
                  </Text>
                </View>
                <StatusText
                  label={expired ? 'expired' : bucket}
                  color={pillToneColor(statusTone(item), colors)}
                />
              </View>

              {pending ? (
                <View
                  style={{
                    flexDirection: 'row',
                    gap: spacing.sm,
                    marginTop: spacing.md,
                  }}
                >
                  {item.invite_url ? (
                    <View style={{ flex: 1 }}>
                      <Button
                        label="Copy link"
                        variant="secondary"
                        size="sm"
                        onPress={() => void copyLink(item.invite_url!)}
                      />
                    </View>
                  ) : null}
                  <View style={{ flex: 1 }}>
                    <Button
                      label="Revoke"
                      variant="danger-ghost"
                      size="sm"
                      loading={busyId === item.id}
                      onPress={() => setConfirm(item)}
                    />
                  </View>
                </View>
              ) : null}
            </View>
          );
        }}
      />

      <Sheet
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title="Invite a user"
        footer={
          <Button
            label="Send invitation"
            onPress={() => void sendInvite()}
            loading={inviteBusy}
            disabled={!inviteEmail.trim() || !inviteRole}
          />
        }
      >
        <View style={{ gap: spacing.md }}>
          {inviteError ? <Banner tone="danger" message={inviteError} /> : null}
          <Text style={{ fontSize: fontSize.sm, color: colors.muted }}>
            We’ll email a setup link. They pick their password and join the workspace with the role
            you choose.
          </Text>
          <FormInput
            label="Email"
            value={inviteEmail}
            onChangeText={setInviteEmail}
            placeholder="name@company.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <SelectInput
            label="Role"
            value={inviteRole}
            onChange={(v) => setInviteRole(v as Role)}
            placeholder="Select a role…"
            options={invitableRoles.map((r) => ({ value: r, label: ROLE_LABEL[r] ?? r }))}
          />
        </View>
      </Sheet>

      <ConfirmSheet
        open={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={() => confirm && void revoke(confirm)}
        title="Revoke invitation?"
        message={
          confirm
            ? `The setup link sent to ${confirm.email} will stop working immediately. This can't be undone — you'd have to send a fresh invite.`
            : undefined
        }
        confirmLabel="Revoke"
        destructive
        pending={!!busyId}
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
