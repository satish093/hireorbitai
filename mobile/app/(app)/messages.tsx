import { useCallback, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ListScreen, PageHeader } from '../../src/components/ui/Screen';
import { Card } from '../../src/components/ui/Card';
import { Avatar } from '../../src/components/ui/Avatar';
import { Pill } from '../../src/components/ui/Pill';
import { SearchInput } from '../../src/components/ui/Inputs';
import { RouteGuard } from '../../src/components/RouteGuard';
import { useApiList } from '../../src/hooks/useApi';
import { useRealtime } from '../../src/hooks/useRealtime';
import { MESSAGING_ROLES, ROLE_LABEL, type Conversation } from '../../src/types';
import { useTheme } from '../../src/theme';
import { relativeDate } from './jobs';

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
 */
export default function MessagesScreen() {
  return (
    <RouteGuard allow={[...MESSAGING_ROLES]} feature="messages">
      <ConversationList />
    </RouteGuard>
  );
}

function ConversationList() {
  const router = useRouter();
  const { colors, spacing, fontSize } = useTheme();
  const [query, setQuery] = useState('');

  const { items, loading, refreshing, error, onRefresh, refetch } = useApiList<Conversation>(
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (c) =>
        c.peer?.full_name?.toLowerCase().includes(q) || c.peer?.email?.toLowerCase().includes(q),
    );
  }, [items, query]);

  return (
    <>
      <PageHeader title="Inbox" />
      <ListScreen
        items={filtered}
        loading={loading}
        refreshing={refreshing}
        error={error}
        onRefresh={onRefresh}
        onRetry={reload}
        keyExtractor={(c) => c.peer?.id ?? Math.random().toString()}
        header={<SearchInput value={query} onChangeText={setQuery} placeholder="Search people" />}
        emptyTitle={query ? 'No matches' : 'No conversations'}
        emptyDescription={
          query
            ? 'Try a different name.'
            : 'Start a conversation from a teammate’s profile, or wait for someone to reach out.'
        }
        renderItem={({ item }) => {
          const unread = item.unread_count > 0;
          return (
            <Card onPress={() => router.push(`/(app)/chat/${item.peer.id}`)}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                <Avatar
                  id={item.peer.id}
                  name={item.peer.full_name}
                  email={item.peer.email}
                  uri={item.peer.avatar_url}
                  size={44}
                />
                <View style={{ flex: 1 }}>
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
                      {item.peer.full_name?.trim() || item.peer.email}
                    </Text>
                    {item.last_message?.created_at ? (
                      <Text style={{ fontSize: fontSize.xs, color: colors.faint }}>
                        {relativeDate(item.last_message.created_at)}
                      </Text>
                    ) : null}
                  </View>

                  <Text
                    numberOfLines={1}
                    style={{
                      fontSize: fontSize.sm,
                      color: unread ? colors.ink2 : colors.muted,
                      marginTop: 2,
                    }}
                  >
                    {item.last_message?.deleted_at
                      ? 'Message deleted'
                      : (item.last_message?.body ?? 'No messages yet')}
                  </Text>

                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: spacing.sm,
                      marginTop: 6,
                    }}
                  >
                    {item.peer.role ? (
                      <Pill label={ROLE_LABEL[item.peer.role]} tone="neutral" size="sm" />
                    ) : null}
                    {unread ? (
                      <Pill
                        label={item.unread_count > 99 ? '99+' : String(item.unread_count)}
                        tone="accent"
                        size="sm"
                      />
                    ) : null}
                  </View>
                </View>
              </View>
            </Card>
          );
        }}
      />
    </>
  );
}
