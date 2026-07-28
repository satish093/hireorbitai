import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Screen, Banner } from '../../../src/components/ui/Screen';
import { Avatar } from '../../../src/components/ui/Avatar';
import { EmptyState, SkeletonList } from '../../../src/components/ui/States';
import { RouteGuard } from '../../../src/components/RouteGuard';
import { useApiList } from '../../../src/hooks/useApi';
import { useRealtime } from '../../../src/hooks/useRealtime';
import { invalidate } from '../../../src/hooks/useInvalidate';
import { useAuth } from '../../../src/context/AuthContext';
import { api, apiErrorMessage } from '../../../src/services/api';
import { useScreenCaptureGuard } from '../../../src/security/PrivacyScreen';
import { MESSAGING_ROLES, type Message } from '../../../src/types';
import { useTheme } from '../../../src/theme';
import { timeOfDay } from '../../../src/utils/format';

/**
 * Message thread — GET /messages/with/:userId, POST /messages.
 *
 * Whether this thread is even allowed is decided server-side by
 * permission.service.ts. If the relationship is removed while the thread is
 * open, the next fetch 403s and the thread becomes unreachable — that is the
 * designed fail-closed behaviour ("no prior-thread carry-over"), not a bug, so
 * the error is surfaced rather than swallowed.
 *
 * Screen capture is guarded: DMs routinely carry candidate details, rates and
 * internal notes.
 */
export default function ChatScreen() {
  return (
    <RouteGuard allow={[...MESSAGING_ROLES]} feature="messages">
      <ChatThread />
    </RouteGuard>
  );
}

function ChatThread() {
  useScreenCaptureGuard();

  const { peerId } = useLocalSearchParams<{ peerId: string }>();
  const { profile } = useAuth();
  const { colors, spacing, fontSize, radius } = useTheme();
  const insets = useSafeAreaInsets();
  const listRef = useRef<FlatList<Message>>(null);

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const thread = useApiList<Message>(peerId ? `/messages/with/${peerId}` : null, {
    channel: 'messages',
    enabled: !!peerId,
  });

  const reload = useCallback(() => {
    void thread.refetch();
  }, [thread]);

  useRealtime(
    {
      'message:new': reload,
      'message:edited': reload,
      'message:deleted': reload,
    },
    { onReconnect: reload },
  );

  // Mark read on open. Fire-and-forget: a failure here costs an unread badge,
  // not a message, and must never block rendering the thread.
  useEffect(() => {
    if (!peerId) return;
    void api
      .post(`/messages/with/${peerId}/read`)
      .then(() => invalidate('messages'))
      .catch(() => {});
  }, [peerId]);

  const send = async () => {
    const body = draft.trim();
    if (!body || !peerId || sending) return;
    setSending(true);
    setSendError(null);
    try {
      await api.post('/messages', { recipient_id: peerId, body });
      setDraft('');
      await thread.refetch();
      invalidate('messages');
      // Newest is at the bottom; scroll after the refetch has landed.
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    } catch (err) {
      setSendError(apiErrorMessage(err, 'Message not sent.'));
    } finally {
      setSending(false);
    }
  };

  const messages = thread.items;
  const peerName =
    messages.find((m) => m.sender_id === peerId)?.sender?.full_name ?? 'Conversation';

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: peerName }} />
      <Screen edges={['bottom']}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 44 : 0}
        >
          {thread.loading && messages.length === 0 ? (
            <View style={{ padding: spacing.lg }}>
              <SkeletonList count={4} />
            </View>
          ) : thread.error && messages.length === 0 ? (
            <View style={{ padding: spacing.lg }}>
              <Banner tone="danger" message={thread.error} />
            </View>
          ) : (
            <FlatList
              ref={listRef}
              data={messages}
              keyExtractor={(m) => m.id}
              contentContainerStyle={{
                padding: spacing.lg,
                gap: spacing.sm,
                flexGrow: 1,
                justifyContent: messages.length === 0 ? 'center' : 'flex-start',
              }}
              onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
              ListEmptyComponent={
                <EmptyState title="No messages yet" description="Say hello to get started." />
              }
              renderItem={({ item }) => {
                const mine = item.sender_id === profile?.id;
                const deleted = !!item.deleted_at;
                return (
                  <View
                    style={{
                      flexDirection: 'row',
                      justifyContent: mine ? 'flex-end' : 'flex-start',
                      alignItems: 'flex-end',
                      gap: spacing.sm,
                    }}
                  >
                    {!mine ? (
                      <Avatar
                        id={item.sender?.id}
                        name={item.sender?.full_name}
                        email={item.sender?.email}
                        size={28}
                      />
                    ) : null}
                    <View
                      style={{
                        maxWidth: '78%',
                        backgroundColor: mine ? colors.accent : colors.surface,
                        borderColor: mine ? colors.accent : colors.border,
                        borderWidth: 1,
                        borderRadius: radius.xl,
                        paddingHorizontal: spacing.md,
                        paddingVertical: spacing.sm,
                      }}
                    >
                      {item.is_internal_note ? (
                        <Text
                          style={{
                            fontSize: fontSize.xs,
                            fontWeight: '700',
                            color: mine ? '#ffffff' : colors.warn,
                            marginBottom: 2,
                          }}
                        >
                          INTERNAL NOTE
                        </Text>
                      ) : null}
                      <Text
                        style={{
                          fontSize: fontSize.base,
                          lineHeight: 21,
                          fontStyle: deleted ? 'italic' : 'normal',
                          color: deleted
                            ? mine
                              ? 'rgba(255,255,255,0.7)'
                              : colors.faint
                            : mine
                              ? '#ffffff'
                              : colors.ink,
                        }}
                      >
                        {deleted ? 'Message deleted' : item.body}
                      </Text>
                      <Text
                        style={{
                          fontSize: fontSize.xs,
                          marginTop: 3,
                          color: mine ? 'rgba(255,255,255,0.75)' : colors.faint,
                        }}
                      >
                        {timeOfDay(item.created_at)}
                        {item.edited_at ? ' · edited' : ''}
                      </Text>
                    </View>
                  </View>
                );
              }}
            />
          )}

          {sendError ? (
            <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.sm }}>
              <Banner tone="danger" message={sendError} />
            </View>
          ) : null}

          <View
            style={{
              flexDirection: 'row',
              alignItems: 'flex-end',
              gap: spacing.sm,
              paddingHorizontal: spacing.lg,
              paddingTop: spacing.sm,
              paddingBottom: spacing.sm,
              borderTopWidth: 1,
              borderTopColor: colors.border,
              backgroundColor: colors.bgElev,
            }}
          >
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Message…"
              placeholderTextColor={colors.faint}
              multiline
              style={{
                flex: 1,
                minHeight: 44,
                maxHeight: 120,
                borderRadius: radius.xl,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.surface,
                color: colors.ink,
                paddingHorizontal: spacing.md,
                paddingTop: 11,
                paddingBottom: 11,
                // Never below 16 — see components/ui/Inputs.tsx.
                fontSize: 16,
              }}
            />
            <Pressable
              onPress={send}
              disabled={!draft.trim() || sending}
              accessibilityRole="button"
              accessibilityLabel="Send message"
              style={{
                width: 44,
                height: 44,
                borderRadius: 22,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: draft.trim() ? colors.accent : colors.hover,
                opacity: sending ? 0.6 : 1,
              }}
            >
              <Text style={{ color: draft.trim() ? '#ffffff' : colors.faint, fontSize: 18 }}>
                ↑
              </Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Screen>
    </>
  );
}
