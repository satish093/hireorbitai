import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { Avatar } from '../components/TaskBits';
import { PresenceDot, PresencePill } from '../components/PresenceDot';
import { GroupBadge } from '../components/GroupBadge';
import { Button } from '../components/Button';
import { IconSearch, IconVideo, IconPhone, IconSend } from '../components/Icons';
import { NotificationToggle } from '../components/NotificationToggle';
import { CallModal } from '../components/CallModal';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useRealtime } from '../hooks/useRealtime';
import { useCall } from '../hooks/useCall';
import { Role, ROLE_LABEL } from '../types';
import toast from 'react-hot-toast';
import clsx from 'clsx';

interface Party {
  id: string;
  email: string;
  full_name?: string | null;
  role?: Role;
  last_seen_at?: string | null;
  group_id?: string | null;
}

interface Message {
  id: string;
  sender_id: string;
  recipient_id: string;
  body: string;
  read_at: string | null;
  created_at: string;
  edited_at?: string | null;
  sender?: Party;
  recipient?: Party;
}

interface Conversation {
  peer: Party;
  last_message: Message;
  unread_count: number;
}

// Two cadences. The active thread polls fast for snappy UX; the conversation
// list + directory rarely change and don't need 4s polling. Combined this
// drops the per-tab steady-state load from ~45 req/min to ~9 req/min.
const THREAD_POLL_MS = 8_000; // active thread only
const SIDEBAR_POLL_MS = 60_000; // conversations + directory

export function Messages() {
  const { profile } = useAuth();
  const [params, setParams] = useSearchParams();
  const activePeerId = params.get('with') ?? null;

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [directory, setDirectory] = useState<Party[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  // Single search box at the top of the chat list. Filters existing
  // conversations and, when non-empty, surfaces matching directory people so
  // you can start a brand-new chat without a separate compose popover.
  const [search, setSearch] = useState('');
  const [sending, setSending] = useState(false);
  // True when the backend returned 403 for the currently-targeted thread.
  // Triggers the "you no longer have access" panel + suppresses message-
  // polling for the denied peer until the user picks a different peer.
  const [accessDenied, setAccessDenied] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  // Tracks which peer's response is currently in flight so a late-arriving
  // older response can't clobber a newer thread.
  const inflightPeerRef = useRef<string | null>(null);
  // Track whether the user is near the bottom — only auto-scroll then, so
  // a poll tick can't yank them away from history they're reading.
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  // Monotonic counter so the optimistic id is unique even within the same ms.
  const tmpIdRef = useRef(0);

  // WebRTC call state machine — handles outbound/inbound, signaling via SSE.
  const call = useCall();

  // Pulls conversations + active thread on a poll.
  const refresh = useCallback(async () => {
    try {
      const [c, d] = await Promise.all([
        api.get('/messages/conversations'),
        api.get('/messages/directory'),
      ]);
      setConversations(c.data ?? []);
      setDirectory(d.data ?? []);
    } catch (e: any) {
      const msg = e?.response?.data?.error ?? 'Failed to load conversations';
      if (/messages/.test(String(msg))) {
        toast.error(`${msg} (run database/messages.sql)`);
      } else {
        toast.error(msg);
      }
    }
  }, []);

  const loadThread = useCallback(async (peerId: string) => {
    inflightPeerRef.current = peerId;
    try {
      const r = await api.get(`/messages/with/${peerId}`);
      // Only apply if this response still matches the active peer.
      if (inflightPeerRef.current !== peerId) return;
      // Merge, don't replace. Two races otherwise:
      //   1) The user fires off a send, the optimistic tmp- row is in
      //      local state, the poll fires the same tick — the poll
      //      snapshot was generated BEFORE the POST hit the DB, so its
      //      response doesn't include the new message. Plain replace
      //      would wipe the optimistic row and the message would
      //      "disappear" until the next poll.
      //   2) A realtime message:new arrives during the poll's network
      //      roundtrip — the SSE handler already inserted it locally,
      //      but the poll snapshot was taken before the server row
      //      existed. Plain replace would wipe it.
      // Fix: take the server snapshot as authoritative for real-id
      // rows, then append back any LOCAL rows the snapshot didn't
      // know about — namely tmp- rows still in flight, plus any
      // real-id rows the server hadn't seen yet at snapshot time.
      const snapshot = (r.data ?? []) as Message[];
      setMessages((prev) => {
        const ids = new Set(snapshot.map((x) => x.id));
        const missing = prev.filter((x) => !ids.has(x.id));
        if (missing.length === 0) return snapshot;
        // Re-sort by created_at so a late-arriving local row interleaves
        // correctly with the snapshot.
        return [...snapshot, ...missing].sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
        );
      });
      setAccessDenied(false);
      // Best-effort mark-read (no toast on failure). Skipping when access
      // is denied so we don't fire a guaranteed-403 follow-up call.
      api.post(`/messages/with/${peerId}/read`).catch(() => {});
    } catch (e: any) {
      if (inflightPeerRef.current !== peerId) return;
      // 403 = hierarchy says we can't see this thread (peer reassigned,
      // group changed, role changed, etc.). Show the access-denied panel
      // instead of a generic error toast. The user can click another
      // conversation to clear the state.
      if (e?.response?.status === 403) {
        setMessages([]);
        setAccessDenied(true);
        return;
      }
      setAccessDenied(false);
      toast.error(e?.response?.data?.error ?? 'Failed to load thread');
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);
  useEffect(() => {
    if (!activePeerId) {
      setMessages([]);
      setAccessDenied(false);
      inflightPeerRef.current = null;
      return;
    }
    stickToBottomRef.current = true; // jump to bottom when switching threads
    setAccessDenied(false); // optimistic — clears any previous deny while the new load is inflight
    loadThread(activePeerId);
  }, [activePeerId, loadThread]);

  // Two pollers: fast for the active thread, slow for the conversation list.
  // Both pause when the tab is hidden, skip if a previous tick is still in
  // flight, and self-schedule with jitter to avoid all-tabs-fire-at-once
  // patterns when a backgrounded tab returns to the foreground.

  // Active-thread poller — only mounted when there IS an active peer AND
  // access isn't already denied. Once denied, polling is silenced until the
  // user picks a different peer; otherwise we'd fire one guaranteed 403
  // every 8 s for no benefit.
  useEffect(() => {
    if (!activePeerId || accessDenied) return;
    let cancelled = false;
    let inflight = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      if (cancelled) return;
      if (document.hidden || inflight) {
        schedule();
        return;
      }
      inflight = true;
      try {
        await loadThread(activePeerId);
      } finally {
        inflight = false;
        schedule();
      }
    };
    function schedule() {
      if (cancelled) return;
      const jitter = THREAD_POLL_MS * 0.1 * Math.random();
      timer = setTimeout(tick, THREAD_POLL_MS + jitter);
    }
    schedule();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [activePeerId, accessDenied, loadThread]);

  // Conversation list + directory poller — runs regardless of selection but
  // at a much slower cadence. The unread badge updates show up in <1 minute
  // even on the slow poll.
  useEffect(() => {
    let cancelled = false;
    let inflight = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      if (cancelled) return;
      if (document.hidden || inflight) {
        schedule();
        return;
      }
      inflight = true;
      try {
        await refresh();
      } finally {
        inflight = false;
        schedule();
      }
    };
    function schedule() {
      if (cancelled) return;
      const jitter = SIDEBAR_POLL_MS * 0.1 * Math.random();
      timer = setTimeout(tick, SIDEBAR_POLL_MS + jitter);
    }
    schedule();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [refresh]);

  // Realtime push channel — server pushes message:new / message:edited /
  // message:deleted events as soon as they happen, so the active thread
  // updates with <100ms latency instead of waiting for the 8s polling
  // tick. The polling stays as a fallback for the case where the SSE
  // connection drops mid-session.
  useRealtime({
    'message:new': (raw) => {
      const m = raw as Message;
      // Active-thread merge — only if this message belongs to the open
      // conversation.
      if (
        activePeerId &&
        ((m.sender_id === activePeerId && m.recipient_id === profile?.id) ||
          (m.recipient_id === activePeerId && m.sender_id === profile?.id))
      ) {
        setMessages((arr) => {
          // 1. Already have it (POST response beat the SSE — dedupe by id).
          if (arr.some((x) => x.id === m.id)) return arr;
          // 2. Our own message, SSE beat the POST response. There's a
          //    tmp- row in the array with the same body; swap it for
          //    the real server row instead of appending a duplicate.
          //    Without this the user sees their message TWICE (once as
          //    optimistic, once as the SSE-delivered server row) until
          //    the next poll merges things back together.
          if (m.sender_id === profile?.id) {
            const tmpIdx = arr.findIndex(
              (x) => x.id.startsWith('tmp-') && x.body === m.body && x.sender_id === m.sender_id,
            );
            if (tmpIdx >= 0) {
              const next = arr.slice();
              next[tmpIdx] = m;
              return next;
            }
          }
          return [...arr, m];
        });
        stickToBottomRef.current = true;
      }
      // Refresh the sidebar so the conversation list reorders + the
      // unread count bumps. The refresh is debounced naturally by the
      // 60s poller already in place; one extra fetch here is cheap.
      void refresh();
    },
    'message:edited': (raw) => {
      const m = raw as Message;
      setMessages((arr) => arr.map((x) => (x.id === m.id ? m : x)));
    },
    'message:deleted': (raw) => {
      const { id } = raw as { id: string };
      setMessages((arr) => arr.filter((x) => x.id !== id));
      void refresh();
    },
    ...call.realtimeHandlers,
  });

  // Auto-scroll only when the user is already near the bottom.
  useEffect(() => {
    if (stickToBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [messages, activePeerId]);

  function onScrollMessages() {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 80;
  }

  const activePeer: Party | undefined = useMemo(() => {
    if (!activePeerId) return undefined;
    return (
      conversations.find((c) => c.peer.id === activePeerId)?.peer ??
      directory.find((p) => p.id === activePeerId)
    );
  }, [activePeerId, conversations, directory]);

  async function send() {
    if (!activePeerId || !draft.trim()) return;
    setSending(true);
    const body = draft;
    // Optimistic append.
    tmpIdRef.current += 1;
    const optimistic: Message = {
      id: `tmp-${Date.now()}-${tmpIdRef.current}`,
      sender_id: profile?.id ?? '',
      recipient_id: activePeerId,
      body,
      read_at: null,
      created_at: new Date().toISOString(),
    };
    setMessages((m) => [...m, optimistic]);
    setDraft('');
    stickToBottomRef.current = true;
    try {
      // The server fans out a message:new SSE to both ends, so by the
      // time this resolves the SSE may have ALREADY swapped the tmp-
      // row for the real one (see the 'message:new' handler's
      // "SSE beat the POST response" branch). Be idempotent: if a row
      // with the saved id is already present, drop the tmp- row and
      // leave the SSE-delivered one in place. Otherwise do the swap.
      const res = await api.post('/messages', { recipient_id: activePeerId, body });
      const saved = res.data as Message;
      setMessages((m) => {
        if (m.some((x) => x.id === saved.id)) {
          return m.filter((x) => x.id !== optimistic.id);
        }
        return m.map((x) => (x.id === optimistic.id ? saved : x));
      });
      // Refresh the conversation list (reorder, unread counts) but skip
      // loadThread — the optimistic row is now the canonical row, and any
      // peer message that arrived in the same window already came in via
      // SSE.
      refresh();
    } catch (e: any) {
      // Roll back optimistic message regardless of the failure reason.
      setMessages((m) => m.filter((x) => x.id !== optimistic.id));
      if (e?.response?.status === 403) {
        // Hierarchy says we can't message this peer (likely reassigned out
        // from under us). Surface the access-denied panel and clear the
        // composer — no point letting the user retry with the same payload.
        setAccessDenied(true);
        toast.error('You can no longer message this user.');
        setDraft('');
      } else {
        toast.error(e?.response?.data?.error ?? 'Send failed');
        setDraft(body);
      }
    } finally {
      setSending(false);
    }
  }

  const q = search.trim().toLowerCase();
  const conversationPeerIds = new Set(conversations.map((c) => c.peer.id));
  // Existing conversations matching the search box.
  const filteredConversations = conversations.filter((c) => {
    if (!q) return true;
    return (c.peer.full_name ?? c.peer.email).toLowerCase().includes(q);
  });
  // Always surface the rest of the user's permitted directory under the
  // existing conversations — Discord-style: every person you can DM is
  // visible from the start, you don't have to "search to discover". The
  // backend already scopes /messages/directory by permission.service rules
  // (recruiter→assigned consultants + manager chain, consultant→recruiter
  // + chain, every user→active developers, etc.), so what lands here is
  // exactly the set the caller is allowed to chat with.
  const filteredDirectory = directory
    .filter((p) => !conversationPeerIds.has(p.id))
    .filter((p) => !q || (p.full_name ?? p.email).toLowerCase().includes(q));

  return (
    <Layout
      title="Messages"
      crumbs={[{ label: 'Workspace', to: '/dashboard' }, { label: 'Messages' }]}
    >
      <div className="bg-surface border border-border rounded-xl overflow-hidden h-[calc(100dvh-180px)] min-h-[480px] flex flex-col sm:flex-row">
        {/* Left: conversation list. Becomes a full-width column on phones
            (stacked above the chat pane); fixed 20rem rail on tablet+. */}
        <aside
          className={clsx(
            'w-full sm:w-80 sm:flex shrink-0 border-b sm:border-b-0 sm:border-r border-border flex-col bg-surface sm:max-h-none',
            activePeer ? 'hidden' : 'flex',
          )}
        >
          <div className="px-4 pt-3.5 pb-2 flex items-center justify-between">
            <h2 className="text-base font-semibold text-ink">Chats</h2>
            {/* Discord-style notification toggle: prompts for browser
                permission on first click; subsequent clicks toggle the
                notify-sound preference. The actual delivery (title bar
                count, favicon dot, desktop notification, ding) is wired
                up in useInboxNotifications, mounted at App level via
                RealtimeNotifications. */}
            <NotificationToggle />
          </div>

          {/* Persistent search bar — filters chats and, once you type, also
              surfaces matching people you haven't messaged yet. */}
          <div className="px-3 pb-2">
            <div className="relative">
              <IconSearch
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
              />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search or start a new chat"
                className="w-full text-sm bg-hover/60 rounded-full pl-9 pr-3 py-2 text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand-500/40"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {filteredConversations.length === 0 && filteredDirectory.length === 0 ? (
              <p className="text-xs text-muted italic px-4 py-6 text-center">
                {conversations.length === 0 && directory.length === 0
                  ? 'No one is reachable yet. Ask an admin to assign your group / recruiter.'
                  : 'No matches.'}
              </p>
            ) : (
              <>
                {filteredConversations.map((c) => {
                  const active = c.peer.id === activePeerId;
                  return (
                    <button
                      key={c.peer.id}
                      onClick={() => setParams({ with: c.peer.id })}
                      className={clsx(
                        'w-full flex items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-hover/60',
                        active && 'bg-hover',
                      )}
                    >
                      <div className="relative shrink-0">
                        <Avatar name={c.peer.full_name} email={c.peer.email} size={44} />
                        <PresenceDot
                          lastSeenAt={c.peer.last_seen_at}
                          className="absolute -bottom-0.5 -right-0.5"
                        />
                      </div>
                      <div className="flex-1 min-w-0 border-b border-border/60 pb-2.5 -mt-0.5">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-sm font-medium truncate inline-flex items-center gap-1.5 text-ink">
                            <GroupBadge groupId={c.peer.group_id ?? null} compact hideEmpty />
                            {c.peer.full_name ?? c.peer.email}
                          </span>
                          <span
                            className={clsx(
                              'text-[11px] shrink-0',
                              c.unread_count > 0
                                ? 'text-brand-600 dark:text-brand-200 font-semibold'
                                : 'text-muted',
                            )}
                          >
                            {relative(c.last_message.created_at)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2 mt-0.5">
                          <p
                            className={clsx(
                              'text-xs truncate',
                              c.unread_count > 0 ? 'text-ink font-medium' : 'text-muted',
                            )}
                          >
                            {c.last_message.sender_id === profile?.id ? 'You: ' : ''}
                            {c.last_message.body}
                          </p>
                          {c.unread_count > 0 && (
                            <span className="shrink-0 bg-brand-500 text-white text-[10px] font-semibold rounded-full px-1.5 min-w-[18px] h-[18px] flex items-center justify-center">
                              {c.unread_count}
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}

                {filteredDirectory.length > 0 && (
                  <>
                    <div className="px-4 pt-3 pb-1 text-[10px] uppercase tracking-widest text-muted">
                      {q ? 'People' : 'Start a new chat'}
                    </div>
                    {filteredDirectory.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => {
                          setParams({ with: p.id });
                          setSearch('');
                        }}
                        className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-hover/60 text-left transition-colors"
                      >
                        <div className="relative shrink-0">
                          <Avatar name={p.full_name} email={p.email} size={40} />
                          <PresenceDot
                            lastSeenAt={p.last_seen_at}
                            size={9}
                            className="absolute -bottom-0.5 -right-0.5"
                          />
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm text-ink truncate">{p.full_name ?? p.email}</div>
                          <div className="text-[10px] uppercase tracking-wider text-muted flex items-center gap-1.5">
                            <span>{p.role && ROLE_LABEL[p.role]}</span>
                            <GroupBadge groupId={p.group_id ?? null} compact hideEmpty />
                          </div>
                        </div>
                      </button>
                    ))}
                  </>
                )}
              </>
            )}
          </div>
        </aside>

        {/* Right: active thread */}
        <main className={clsx('flex-1 flex-col min-w-0', activePeer ? 'flex' : 'hidden sm:flex')}>
          {!activePeer ? (
            <div className="flex-1 flex items-center justify-center text-muted text-sm bg-hover/30">
              Select a conversation, or search a name to start a new one.
            </div>
          ) : (
            <>
              <header className="px-5 py-3 border-b border-border flex items-center gap-3 bg-surface">
                <button
                  className="sm:hidden -ml-1 mr-1 p-1.5 rounded-lg hover:bg-hover text-muted shrink-0"
                  onClick={() => {
                    const next = new URLSearchParams(params);
                    next.delete('with');
                    setParams(next, { replace: true });
                  }}
                  aria-label="Back to conversations"
                >
                  ←
                </button>
                <div className="relative shrink-0">
                  <Avatar name={activePeer.full_name} email={activePeer.email} size={40} />
                  <PresenceDot
                    lastSeenAt={activePeer.last_seen_at}
                    className="absolute -bottom-0.5 -right-0.5"
                  />
                </div>
                <div className="leading-tight min-w-0">
                  <div className="text-sm font-semibold text-ink flex items-center gap-2">
                    <span className="truncate">{activePeer.full_name ?? activePeer.email}</span>
                    <PresencePill lastSeenAt={activePeer.last_seen_at} />
                  </div>
                  <div className="text-[11px] text-muted truncate">
                    {activePeer.role && ROLE_LABEL[activePeer.role]} · {activePeer.email}
                  </div>
                </div>
                {/* Call buttons — disabled while already in a call */}
                <div className="ml-auto flex items-center gap-1 text-muted">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    iconOnly
                    leftIcon={<IconVideo size={18} />}
                    title="Video call"
                    disabled={call.status !== 'idle'}
                    onClick={() =>
                      call
                        .startCall(
                          activePeer.id,
                          activePeer.full_name ?? null,
                          activePeer.email,
                          'video',
                        )
                        .catch((e: Error) => toast.error(e.message))
                    }
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    iconOnly
                    leftIcon={<IconPhone size={18} />}
                    title="Voice call"
                    disabled={call.status !== 'idle'}
                    onClick={() =>
                      call
                        .startCall(
                          activePeer.id,
                          activePeer.full_name ?? null,
                          activePeer.email,
                          'audio',
                        )
                        .catch((e: Error) => toast.error(e.message))
                    }
                  />
                </div>
              </header>

              {accessDenied ? (
                // Hierarchy says we no longer have access to this peer. Shown
                // instead of the messages + composer. The user can pick a
                // different conversation from the sidebar, or hit the "Back
                // to inbox" button to clear the ?with= URL param.
                <div className="flex-1 flex items-center justify-center px-6 py-8 bg-hover/30">
                  <div className="max-w-sm text-center space-y-3">
                    <div className="text-4xl text-muted">🔒</div>
                    <h3 className="text-base font-semibold text-ink">
                      Conversation no longer available
                    </h3>
                    <p className="text-sm text-muted leading-snug">
                      You no longer have access to this conversation — your team assignment may have
                      changed. Past messages are preserved; they'll come back if access is restored.
                    </p>
                    <Button
                      type="button"
                      variant="primary"
                      className="mt-2"
                      onClick={() => {
                        const next = new URLSearchParams(params);
                        next.delete('with');
                        setParams(next, { replace: true });
                      }}
                    >
                      ← Back to inbox
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <div
                    ref={scrollContainerRef}
                    onScroll={onScrollMessages}
                    className="flex-1 overflow-y-auto px-5 py-4 space-y-3 bg-hover/30"
                  >
                    {messages.length === 0 ? (
                      <p className="text-center text-sm text-muted italic mt-6">
                        No messages yet — say hello!
                      </p>
                    ) : (
                      groupByDay(messages).map(({ day, items }) => (
                        <div key={day}>
                          <div className="text-center my-2">
                            <span className="text-[10px] uppercase tracking-widest text-muted bg-surface border border-border px-2 py-0.5 rounded-full">
                              {day}
                            </span>
                          </div>
                          <div className="space-y-2">
                            {items.map((m) => (
                              <Bubble
                                key={m.id}
                                message={m}
                                mine={m.sender_id === profile?.id}
                                onEdit={async (newBody) => {
                                  // Optimistic local update; PATCH in
                                  // background. Roll back on failure.
                                  const prev = m;
                                  setMessages((arr) =>
                                    arr.map((x) =>
                                      x.id === m.id
                                        ? {
                                            ...x,
                                            body: newBody,
                                            edited_at: new Date().toISOString(),
                                          }
                                        : x,
                                    ),
                                  );
                                  try {
                                    await api.patch(`/messages/${m.id}`, { body: newBody });
                                  } catch (e: any) {
                                    setMessages((arr) =>
                                      arr.map((x) => (x.id === m.id ? prev : x)),
                                    );
                                    toast.error(e?.response?.data?.error ?? 'Edit failed');
                                  }
                                }}
                                onDelete={async () => {
                                  if (
                                    !confirm(
                                      'Delete this message? Other people will no longer see it.',
                                    )
                                  )
                                    return;
                                  // Optimistic local remove; same roll-back
                                  // pattern as edit on failure.
                                  const prev = m;
                                  setMessages((arr) => arr.filter((x) => x.id !== m.id));
                                  try {
                                    await api.delete(`/messages/${m.id}`);
                                  } catch (e: any) {
                                    setMessages((arr) =>
                                      [...arr, prev].sort((a, b) =>
                                        a.created_at.localeCompare(b.created_at),
                                      ),
                                    );
                                    toast.error(e?.response?.data?.error ?? 'Delete failed');
                                  }
                                }}
                              />
                            ))}
                          </div>
                        </div>
                      ))
                    )}
                    <div ref={messagesEndRef} />
                  </div>

                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      send();
                    }}
                    className="border-t border-border px-3 py-3 flex items-end gap-2 bg-surface"
                  >
                    <textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          send();
                        }
                      }}
                      rows={1}
                      placeholder="Write a message… (Shift+Enter for newline)"
                      className="flex-1 resize-none bg-hover/60 rounded-2xl px-4 py-2.5 text-sm text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand-500/40 max-h-32"
                    />
                    <Button
                      type="submit"
                      variant="primary"
                      iconOnly
                      leftIcon={<IconSend size={18} />}
                      disabled={sending || !draft.trim()}
                      loading={sending}
                      title="Send message"
                      className="shrink-0 !rounded-full !w-10 !h-10"
                    />
                  </form>
                </>
              )}
            </>
          )}
        </main>
      </div>

      {/* Call modal — portaled to document.body, visible when a call is active */}
      <CallModal
        status={call.status}
        callType={call.callType}
        peer={call.peer}
        incomingCall={call.incomingCall}
        localStream={call.localStream}
        remoteStream={call.remoteStream}
        isMuted={call.isMuted}
        isCameraOff={call.isCameraOff}
        onAccept={call.acceptCall}
        onReject={call.rejectCall}
        onEnd={call.endCall}
        onToggleMute={call.toggleMute}
        onToggleCamera={call.toggleCamera}
      />
    </Layout>
  );
}

function Bubble({
  message,
  mine,
  onEdit,
  onDelete,
}: {
  message: Message;
  mine: boolean;
  onEdit?: (newBody: string) => void | Promise<void>;
  onDelete?: () => void | Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.body);
  const [hovered, setHovered] = useState(false);

  // Whenever the message body changes externally (e.g. another tab's edit
  // poll-syncs into our local state) keep the draft in lockstep so opening
  // the editor doesn't show stale text.
  useEffect(() => {
    if (!editing) setDraft(message.body);
  }, [message.body, editing]);

  function commitEdit() {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === message.body || !onEdit) {
      setEditing(false);
      setDraft(message.body);
      return;
    }
    void onEdit(trimmed);
    setEditing(false);
  }

  function cancelEdit() {
    setEditing(false);
    setDraft(message.body);
  }

  return (
    <div
      className={clsx(
        'flex group relative',
        mine ? 'justify-end animate-slide-in-right' : 'justify-start animate-slide-in-left',
      )}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Sender-side action menu — only renders for own messages, only when
          hovered. Edit/Delete callbacks come from the parent. */}
      {mine && (onEdit || onDelete) && hovered && !editing && (
        <div className="absolute -top-3 right-1 inline-flex gap-1 bg-surface border border-border rounded-full shadow-sm px-1 py-0.5 text-[11px] z-10">
          {onEdit && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="px-1.5 text-muted hover:text-ink"
              title="Edit message"
            >
              ✎
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              onClick={() => void onDelete()}
              className="px-1.5 text-rose-600 dark:text-rose-400 hover:text-rose-700"
              title="Delete message"
            >
              ✕
            </button>
          )}
        </div>
      )}

      <div
        className={clsx(
          'max-w-[70%] px-3 py-2 rounded-2xl text-sm whitespace-pre-wrap break-words shadow-sm',
          mine
            ? 'bg-brand-600 text-white rounded-br-sm'
            : 'bg-surface border border-border text-ink rounded-bl-sm',
        )}
      >
        {editing ? (
          <div className="space-y-1.5">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  commitEdit();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  cancelEdit();
                }
              }}
              autoFocus
              rows={Math.max(1, Math.min(6, draft.split('\n').length))}
              className={clsx(
                'w-full resize-none rounded text-sm px-1.5 py-1 focus:outline-none',
                mine ? 'bg-brand-700/40 text-white placeholder:text-white/60' : 'bg-hover text-ink',
              )}
            />
            <div className="flex justify-end gap-1 text-[11px]">
              <button
                type="button"
                onClick={cancelEdit}
                className={clsx(
                  'px-2 py-0.5 rounded',
                  mine ? 'text-white/70 hover:text-white' : 'text-muted hover:text-ink',
                )}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={commitEdit}
                disabled={!draft.trim() || draft.trim() === message.body}
                className={clsx(
                  'px-2 py-0.5 rounded font-semibold disabled:opacity-50',
                  mine
                    ? 'bg-white/15 text-white hover:bg-white/25'
                    : 'bg-ink text-bg hover:opacity-90',
                )}
              >
                Save
              </button>
            </div>
          </div>
        ) : (
          <>
            {message.body}
            <div
              className={clsx(
                'text-[10px] mt-1 flex items-center gap-1',
                mine ? 'text-white/70' : 'text-muted',
              )}
            >
              {new Date(message.created_at).toLocaleTimeString([], {
                hour: 'numeric',
                minute: '2-digit',
              })}
              {message.edited_at && (
                <span className={mine ? 'text-white/60' : 'text-muted'}>· edited</span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function groupByDay(messages: Message[]): { day: string; items: Message[] }[] {
  const out: { day: string; items: Message[] }[] = [];
  for (const m of messages) {
    const day = dayLabel(m.created_at);
    if (out.length === 0 || out[out.length - 1]!.day !== day) {
      out.push({ day, items: [] });
    }
    out[out.length - 1]!.items.push(m);
  }
  return out;
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  if (sameDay) return 'Today';
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function relative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
