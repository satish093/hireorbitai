import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Screen, ListScreen } from '../../src/components/ui/Screen';
import { PageTopBar } from '../../src/components/ui/TopBar';
import { Divider } from '../../src/components/ui/Card';
import { Avatar } from '../../src/components/ui/Avatar';
import { Pill } from '../../src/components/ui/Pill';
import { Sheet } from '../../src/components/ui/Sheet';
import { Icon } from '../../src/components/ui/Icon';
import { SearchInput } from '../../src/components/ui/Inputs';
import { EmptyState } from '../../src/components/ui/States';
import { RouteGuard } from '../../src/components/RouteGuard';
import { useApiList } from '../../src/hooks/useApi';
import { useRealtime } from '../../src/hooks/useRealtime';
import { useAuth } from '../../src/context/AuthContext';
import { api } from '../../src/services/api';
import { MESSAGING_ROLES, ROLE_LABEL, type Conversation, type UserRef } from '../../src/types';
import { useTheme } from '../../src/theme';
import { relativeDate } from '../../src/utils/format';

/**
 * Inbox — the conversation list.
 *
 * Who a user may reach is decided entirely by the server
 * (services/permission.service.ts). The client never computes reachability: it
 * asks for the directory and renders the answer. Getting that wrong on the
 * client would either hide a legitimate contact or show one the backend will
 * 403 on, and the rules are genuinely intricate (group leads, co-management
 * grants, the legacy manager_id column AND the recruiter_managers junction, plus
 * the universal "anyone can reach an active DEVELOPER" rule).
 *
 * Realtime caveat: SSE is FOREGROUND-ONLY. New messages arriving while the app
 * is backgrounded are not delivered — hence the refetch on reconnect. Proper
 * background delivery needs push notifications, which the backend does not yet
 * have. See mobile/README.md §4.
 *
 * Layout mirrors the website's mobile inbox: a "Chats" section header, an
 * amber missed-call banner, a pill search, plain-text All/Unread/Pinned/Archived
 * filters, then borderless conversation rows separated by hairline dividers.
 */
export default function MessagesScreen() {
  return (
    <RouteGuard allow={[...MESSAGING_ROLES]} feature="messages">
      <ConversationList />
    </RouteGuard>
  );
}

/** The server may decorate the peer + conversation with presence + inbox state. */
type ConversationRow = Conversation & {
  pinned?: boolean;
  archived?: boolean;
  peer: UserRef & { last_seen_at?: string | null };
};

const CONV_FILTERS = ['all', 'unread', 'pinned', 'archived'] as const;
type ConvFilter = (typeof CONV_FILTERS)[number];

interface MissedCall {
  id: string;
  ended_at?: string | null;
  started_at?: string | null;
}

function ConversationList() {
  const router = useRouter();
  const { profile } = useAuth();
  const { colors, spacing, fontSize } = useTheme();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ConvFilter>('all');
  const [composeOpen, setComposeOpen] = useState(false);
  const [menuFor, setMenuFor] = useState<ConversationRow | null>(null);
  const [missedDismissed, setMissedDismissed] = useState(false);
  const [missed, setMissed] = useState<MissedCall[]>([]);

  const { items, loading, refreshing, error, onRefresh, refetch } = useApiList<ConversationRow>(
    '/messages/conversations',
    { channel: 'messages' },
  );

  const reload = useCallback(() => {
    void refetch();
  }, [refetch]);

  useRealtime(
    {
      'message:new': reload,
      'message:read': reload,
      'message:deleted': reload,
    },
    // Covers the gap while the socket was down (backgrounded, or a drop).
    { onReconnect: reload },
  );

  // Missed-call banner — best-effort. The calls feature may be flagged off or
  // the endpoint may 404 on older backends; either way the banner stays hidden.
  useEffect(() => {
    let cancelled = false;
    api
      .get<MissedCall[]>('/calls/history', {
        params: { outcome: 'missed', since_hours: 24, limit: 10 },
      })
      .then((r) => {
        if (!cancelled) setMissed(r.data ?? []);
      })
      .catch(() => {
        /* feature off / older backend — banner stays hidden */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setConvState = async (peerId: string, patch: { pinned?: boolean; archived?: boolean }) => {
    try {
      await api.patch(`/messages/with/${peerId}/state`, patch);
    } catch {
      /* fall through to refetch — server truth wins */
    }
    void refetch();
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((c) => {
      if (filter === 'archived') {
        if (!c.archived) return false;
      } else {
        if (c.archived) return false;
        if (filter === 'unread' && c.unread_count <= 0) return false;
        if (filter === 'pinned' && !c.pinned) return false;
      }
      if (!q) return true;
      return (
        c.peer?.full_name?.toLowerCase().includes(q) || c.peer?.email?.toLowerCase().includes(q)
      );
    });
  }, [items, query, filter]);

  const showMissed = missed.length > 0 && !missedDismissed;

  return (
    <Screen edges={['top']}>
      <PageTopBar title="Messages" showBack />
      <ListScreen
        items={filtered}
        loading={loading}
        refreshing={refreshing}
        error={error}
        onRefresh={onRefresh}
        onRetry={reload}
        keyExtractor={(c, i) => c.peer?.id ?? `row-${i}`}
        ItemSeparatorComponent={() => <Divider inset={60} />}
        contentContainerStyle={{
          paddingHorizontal: spacing.lg,
          paddingTop: spacing.sm,
          paddingBottom: spacing['4xl'] + insets.bottom,
          flexGrow: 1,
        }}
        header={
          <View style={{ gap: spacing.md, marginBottom: spacing.xs }}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <Text style={{ fontSize: fontSize.lg, fontWeight: '700', color: colors.ink }}>
                Chats
              </Text>
              <Pressable
                onPress={() => setComposeOpen(true)}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="New message"
                style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}
              >
                <Icon name="mailPlus" size={20} color={colors.ink2} />
              </Pressable>
            </View>

            {showMissed ? (
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: spacing.sm,
                  borderWidth: 1,
                  borderColor: colors.warn,
                  backgroundColor: colors.warnSoft,
                  borderRadius: 12,
                  paddingHorizontal: spacing.md,
                  paddingVertical: spacing.sm,
                }}
              >
                <Icon name="bell" size={16} color={colors.warn} />
                <Text
                  style={{ flex: 1, fontSize: fontSize.sm, color: colors.warn, lineHeight: 18 }}
                >
                  <Text style={{ fontWeight: '700' }}>
                    {missed.length} missed call{missed.length === 1 ? '' : 's'}
                  </Text>{' '}
                  in the last 24 h. Open a conversation to see history.
                </Text>
                <Pressable
                  onPress={() => setMissedDismissed(true)}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel="Dismiss missed-call notice"
                >
                  <Icon name="x" size={15} color={colors.warn} />
                </Pressable>
              </View>
            ) : null}

            <PillSearch
              value={query}
              onChangeText={setQuery}
              placeholder="Search or start a new chat"
            />

            <View style={{ flexDirection: 'row', gap: spacing.lg }}>
              {CONV_FILTERS.map((f) => {
                const active = f === filter;
                return (
                  <Pressable
                    key={f}
                    onPress={() => setFilter(f)}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: active }}
                    hitSlop={6}
                  >
                    <Text
                      style={{
                        fontSize: fontSize.base,
                        textTransform: 'capitalize',
                        fontWeight: active ? '700' : '600',
                        color: active ? colors.ink : colors.muted,
                      }}
                    >
                      {f}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        }
        emptyTitle={
          query ? 'No matches' : filter === 'all' ? 'No conversations' : `No ${filter} chats`
        }
        emptyDescription={
          query
            ? 'Try a different name.'
            : 'Start a conversation from the compose button, or wait for someone to reach out.'
        }
        renderItem={({ item }) => {
          const unread = item.unread_count > 0;
          const name = item.peer.full_name?.trim() || item.peer.email;
          const lastSeen = item.peer.last_seen_at;
          const online = lastSeen ? Date.now() - new Date(lastSeen).getTime() < 120_000 : false;
          const mine = item.last_message?.sender_id === profile?.id;
          const preview = item.last_message?.deleted_at
            ? 'Message deleted'
            : (item.last_message?.body ?? 'No messages yet');
          return (
            <Pressable
              onPress={() => router.push(`/(app)/chat/${item.peer.id}`)}
              accessibilityRole="button"
              style={({ pressed }) => ({
                flexDirection: 'row',
                gap: spacing.md,
                paddingVertical: 12,
                backgroundColor: pressed ? colors.hover : 'transparent',
              })}
            >
              <Avatar
                id={item.peer.id}
                name={item.peer.full_name}
                email={item.peer.email}
                uri={item.peer.avatar_url}
                size={48}
                online={online}
              />
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                  <Text
                    numberOfLines={1}
                    style={{
                      flex: 1,
                      fontSize: fontSize.md,
                      fontWeight: unread ? '700' : '600',
                      color: colors.ink,
                    }}
                  >
                    {name}
                  </Text>
                  {item.last_message?.created_at ? (
                    <Text
                      style={{
                        fontSize: fontSize.xs,
                        color: unread ? colors.accent : colors.faint,
                        fontWeight: unread ? '700' : '400',
                      }}
                    >
                      {relativeDate(item.last_message.created_at)}
                    </Text>
                  ) : null}
                  <Pressable
                    onPress={() => setMenuFor(item)}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel="Conversation options"
                    style={{
                      width: 28,
                      height: 28,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Icon name="more" size={18} color={colors.muted} />
                  </Pressable>
                </View>

                {item.peer.role ? (
                  <View style={{ flexDirection: 'row', marginTop: 3 }}>
                    <Pill label={ROLE_LABEL[item.peer.role]} tone="neutral" size="sm" />
                  </View>
                ) : null}

                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: spacing.sm,
                    marginTop: 4,
                  }}
                >
                  <Text
                    numberOfLines={1}
                    style={{
                      flex: 1,
                      fontSize: fontSize.sm,
                      color: unread ? colors.ink2 : colors.muted,
                      fontWeight: unread ? '600' : '400',
                    }}
                  >
                    {mine ? 'You: ' : ''}
                    {preview}
                  </Text>
                  {unread ? (
                    <Pill
                      label={item.unread_count > 99 ? '99+' : String(item.unread_count)}
                      tone="accent"
                      size="sm"
                    />
                  ) : null}
                </View>
              </View>
            </Pressable>
          );
        }}
      />

      <ComposeSheet
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        onPick={(id) => {
          setComposeOpen(false);
          router.push(`/(app)/chat/${id}`);
        }}
      />

      <Sheet
        open={!!menuFor}
        onClose={() => setMenuFor(null)}
        title={menuFor?.peer.full_name?.trim() || menuFor?.peer.email || 'Conversation'}
      >
        {menuFor ? (
          <View style={{ gap: spacing.sm }}>
            <MenuRow
              label={menuFor.pinned ? 'Unpin' : 'Pin to top'}
              onPress={() => {
                void setConvState(menuFor.peer.id, { pinned: !menuFor.pinned });
                setMenuFor(null);
              }}
            />
            <MenuRow
              label={menuFor.archived ? 'Unarchive' : 'Archive'}
              onPress={() => {
                void setConvState(menuFor.peer.id, { archived: !menuFor.archived });
                setMenuFor(null);
              }}
            />
          </View>
        ) : null}
      </Sheet>
    </Screen>
  );
}

function MenuRow({ label, onPress }: { label: string; onPress: () => void }) {
  const { colors, fontSize, spacing, radius } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => ({
        paddingVertical: spacing.md,
        paddingHorizontal: spacing.md,
        borderRadius: radius.lg,
        backgroundColor: pressed ? colors.hover : 'transparent',
        minHeight: 48,
        justifyContent: 'center',
      })}
    >
      <Text style={{ fontSize: fontSize.md, color: colors.ink }}>{label}</Text>
    </Pressable>
  );
}

/**
 * Pill-shaped search, matching the website's inbox search bar: fully rounded,
 * filled (no border). The shared SearchInput is the rounded-lg bordered variant
 * every other list uses; the inbox is the one place the site goes fully round.
 */
function PillSearch({
  value,
  onChangeText,
  placeholder,
}: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
}) {
  const { colors, fontSize } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        height: 44,
        borderRadius: 999,
        backgroundColor: colors.hover,
        paddingHorizontal: 16,
      }}
    >
      <Text style={{ color: colors.faint, marginRight: 8, fontSize: 16 }}>⌕</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.faint}
        returnKeyType="search"
        autoCapitalize="none"
        autoCorrect={false}
        clearButtonMode="while-editing"
        style={{ flex: 1, color: colors.ink, fontSize: Math.max(16, fontSize.md) }}
      />
    </View>
  );
}

/**
 * Start-a-new-conversation picker — the mobile port of the web's compose flow.
 * Lists everyone the caller is permitted to message (GET /messages/directory,
 * resolved entirely server-side by permission.service.ts) with a search filter.
 * Fetched lazily: the request only fires while the sheet is open.
 */
function ComposeSheet({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (userId: string) => void;
}) {
  const { colors, spacing, fontSize } = useTheme();
  const [q, setQ] = useState('');

  const { items, loading } = useApiList<UserRef>('/messages/directory', {
    channel: 'messages',
    enabled: open,
  });

  const people = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return items;
    return items.filter(
      (p) => p.full_name?.toLowerCase().includes(needle) || p.email?.toLowerCase().includes(needle),
    );
  }, [items, q]);

  return (
    <Sheet open={open} onClose={onClose} title="New message">
      <View style={{ gap: spacing.md }}>
        <SearchInput value={q} onChangeText={setQ} placeholder="Search people" />
        {loading && items.length === 0 ? (
          <Text style={{ color: colors.muted, fontSize: fontSize.sm, paddingVertical: spacing.md }}>
            Loading contacts…
          </Text>
        ) : people.length === 0 ? (
          <EmptyState
            compact
            title={q ? 'No matches' : 'No one to message yet'}
            description={q ? 'Try a different name.' : 'People you can message will appear here.'}
          />
        ) : (
          <ScrollView style={{ maxHeight: 420 }} keyboardShouldPersistTaps="handled">
            {people.map((p) => (
              <Pressable
                key={p.id}
                onPress={() => onPick(p.id)}
                accessibilityRole="button"
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: spacing.md,
                  paddingVertical: 10,
                  paddingHorizontal: 4,
                  borderRadius: 10,
                  backgroundColor: pressed ? colors.hover : 'transparent',
                })}
              >
                <Avatar
                  id={p.id}
                  name={p.full_name}
                  email={p.email}
                  uri={p.avatar_url ?? undefined}
                  size={40}
                />
                <View style={{ flex: 1 }}>
                  <Text
                    numberOfLines={1}
                    style={{ fontSize: fontSize.md, fontWeight: '600', color: colors.ink }}
                  >
                    {p.full_name?.trim() || p.email}
                  </Text>
                  {p.role ? (
                    <Text style={{ fontSize: fontSize.xs, color: colors.muted, marginTop: 1 }}>
                      {ROLE_LABEL[p.role]}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
            ))}
          </ScrollView>
        )}
      </View>
    </Sheet>
  );
}
