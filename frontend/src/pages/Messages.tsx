import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { Avatar } from '../components/TaskBits';
import { PresenceDot, PresencePill } from '../components/PresenceDot';
import { GroupBadge } from '../components/GroupBadge';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useRealtime } from '../hooks/useRealtime';
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
  const [composerOpen, setComposerOpen] = useState(false);
  const [composeSearch, setComposeSearch] = useState('');
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
      setMessages(r.data ?? []);
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
      // conversation. Skip if we already have it (an optimistic local
      // insert from our own send call may have beaten the push).
      if (
        activePeerId &&
        ((m.sender_id === activePeerId && m.recipient_id === profile?.id) ||
          (m.recipient_id === activePeerId && m.sender_id === profile?.id))
      ) {
        setMessages((arr) => (arr.some((x) => x.id === m.id) ? arr : [...arr, m]));
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
      // Replace the optimistic tmp-id row with the real server message
      // BEFORE the realtime push can arrive. The SSE handler dedupes by
      // message id, so if the real id is already in the array by the time
      // the push lands, it short-circuits and we don't render a duplicate.
      const res = await api.post('/messages', { recipient_id: activePeerId, body });
      const saved = res.data as Message;
      setMessages((m) => m.map((x) => (x.id === optimistic.id ? saved : x)));
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

  const conversationPeerIds = new Set(conversations.map((c) => c.peer.id));
  const filteredDirectory = directory
    .filter((p) => !conversationPeerIds.has(p.id))
    .filter((p) => {
      const q = composeSearch.toLowerCase();
      if (!q) return true;
      return (p.full_name ?? p.email).toLowerCase().includes(q);
    });

  return (
    <Layout
      title="Messages"
      crumbs={[{ label: 'Workspace', to: '/dashboard' }, { label: 'Messages' }]}
    >
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden h-[calc(100dvh-180px)] min-h-[480px] flex flex-col sm:flex-row">
        {/* Left: conversation list. Becomes a full-width column on phones
            (stacked above the chat pane); fixed 18rem rail on tablet+. */}
        <aside className="w-full sm:w-72 shrink-0 border-b sm:border-b-0 sm:border-r border-slate-200 flex flex-col bg-slate-50/50 max-h-64 sm:max-h-none">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">Conversations</h2>
            <button
              onClick={() => setComposerOpen((v) => !v)}
              className="w-7 h-7 flex items-center justify-center rounded-full bg-slate-900 text-white text-sm hover:bg-slate-800"
              title="Start a new chat"
            >
              +
            </button>
          </div>

          {composerOpen && (
            <div className="border-b border-slate-200 px-3 py-2 bg-white">
              <input
                value={composeSearch}
                onChange={(e) => setComposeSearch(e.target.value)}
                placeholder="Find a person…"
                autoFocus
                className="w-full text-sm border border-slate-200 rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
              />
              <div className="mt-2 max-h-44 overflow-y-auto -mx-1">
                {filteredDirectory.length === 0 ? (
                  <p className="text-xs text-slate-400 italic px-2 py-3 text-center">
                    {directory.length === 0 ? 'No contacts yet' : 'No matches'}
                  </p>
                ) : (
                  filteredDirectory.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => {
                        setParams({ with: p.id });
                        setComposerOpen(false);
                        setComposeSearch('');
                      }}
                      className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-slate-100 rounded text-left"
                    >
                      <div className="relative">
                        <Avatar name={p.full_name} email={p.email} size={28} />
                        <PresenceDot
                          lastSeenAt={p.last_seen_at}
                          size={8}
                          className="absolute -bottom-0.5 -right-0.5"
                        />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm text-slate-900 truncate">
                          {p.full_name ?? p.email}
                        </div>
                        <div className="text-[10px] uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                          <span>{p.role && ROLE_LABEL[p.role]}</span>
                          <GroupBadge groupId={p.group_id ?? null} compact hideEmpty />
                        </div>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}

          <div className="flex-1 overflow-y-auto">
            {conversations.length === 0 ? (
              <p className="text-xs text-slate-400 italic px-4 py-6 text-center">
                No messages yet. Click + to start a chat.
              </p>
            ) : (
              conversations.map((c) => {
                const active = c.peer.id === activePeerId;
                return (
                  <button
                    key={c.peer.id}
                    onClick={() => setParams({ with: c.peer.id })}
                    className={clsx(
                      'w-full flex items-start gap-2.5 px-4 py-3 text-left border-b border-slate-100 hover:bg-white',
                      active && 'bg-white border-l-2 border-l-brand-500',
                    )}
                  >
                    <div className="relative">
                      <Avatar name={c.peer.full_name} email={c.peer.email} size={36} />
                      <PresenceDot
                        lastSeenAt={c.peer.last_seen_at}
                        className="absolute -bottom-0.5 -right-0.5"
                      />
                      {c.unread_count > 0 && (
                        <span className="absolute -top-1 -right-1 bg-brand-500 text-white text-[10px] font-semibold rounded-full px-1.5 min-w-[18px] h-[18px] flex items-center justify-center">
                          {c.unread_count}
                        </span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-2">
                        <span
                          className={clsx(
                            'text-sm font-medium truncate inline-flex items-center gap-1.5',
                            c.unread_count > 0 ? 'text-slate-900' : 'text-slate-800',
                          )}
                        >
                          <GroupBadge groupId={c.peer.group_id ?? null} compact hideEmpty />
                          {c.peer.full_name ?? c.peer.email}
                        </span>
                        <span className="text-[10px] text-slate-500 shrink-0">
                          {relative(c.last_message.created_at)}
                        </span>
                      </div>
                      <p
                        className={clsx(
                          'text-xs truncate mt-0.5',
                          c.unread_count > 0 ? 'text-slate-700 font-medium' : 'text-slate-500',
                        )}
                      >
                        {c.last_message.sender_id === profile?.id ? 'You: ' : ''}
                        {c.last_message.body}
                      </p>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* Right: active thread */}
        <main className="flex-1 flex flex-col min-w-0">
          {!activePeer ? (
            <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
              Select a conversation, or hit + to start a new one.
            </div>
          ) : (
            <>
              <header className="px-5 py-3 border-b border-slate-200 flex items-center gap-3">
                <div className="relative">
                  <Avatar name={activePeer.full_name} email={activePeer.email} size={36} />
                  <PresenceDot
                    lastSeenAt={activePeer.last_seen_at}
                    className="absolute -bottom-0.5 -right-0.5"
                  />
                </div>
                <div className="leading-tight">
                  <div className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                    {activePeer.full_name ?? activePeer.email}
                    <PresencePill lastSeenAt={activePeer.last_seen_at} />
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {activePeer.role && ROLE_LABEL[activePeer.role]} · {activePeer.email}
                  </div>
                </div>
              </header>

              {accessDenied ? (
                // Hierarchy says we no longer have access to this peer. Shown
                // instead of the messages + composer. The user can pick a
                // different conversation from the sidebar, or hit the "Back
                // to inbox" button to clear the ?with= URL param.
                <div className="flex-1 flex items-center justify-center px-6 py-8 bg-slate-50/30">
                  <div className="max-w-sm text-center space-y-3">
                    <div className="text-4xl text-slate-300">🔒</div>
                    <h3 className="text-base font-semibold text-slate-900">
                      Conversation no longer available
                    </h3>
                    <p className="text-sm text-slate-600 leading-snug">
                      You no longer have access to this conversation — your team assignment may have
                      changed. Past messages are preserved; they'll come back if access is restored.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        const next = new URLSearchParams(params);
                        next.delete('with');
                        setParams(next, { replace: true });
                      }}
                      className="mt-2 inline-flex items-center bg-slate-900 text-white text-sm px-4 py-2 rounded-lg hover:bg-slate-800"
                    >
                      ← Back to inbox
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div
                    ref={scrollContainerRef}
                    onScroll={onScrollMessages}
                    className="flex-1 overflow-y-auto px-5 py-4 space-y-3 bg-slate-50/30"
                  >
                    {messages.length === 0 ? (
                      <p className="text-center text-sm text-slate-400 italic mt-6">
                        No messages yet — say hello!
                      </p>
                    ) : (
                      groupByDay(messages).map(({ day, items }) => (
                        <div key={day}>
                          <div className="text-center my-2">
                            <span className="text-[10px] uppercase tracking-widest text-slate-400 bg-white border border-slate-200 px-2 py-0.5 rounded-full">
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
                    className="border-t border-slate-200 px-4 py-3 flex items-end gap-2 bg-white"
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
                      className="flex-1 resize-none border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/40 max-h-32"
                    />
                    <button
                      type="submit"
                      disabled={sending || !draft.trim()}
                      className="bg-slate-900 text-white text-sm px-4 py-2 rounded-lg disabled:opacity-50 hover:bg-slate-800"
                    >
                      {sending ? 'Sending…' : 'Send'}
                    </button>
                  </form>
                </>
              )}
            </>
          )}
        </main>
      </div>
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
        <div className="absolute -top-3 right-1 inline-flex gap-1 bg-white border border-slate-200 rounded-full shadow-sm px-1 py-0.5 text-[11px] z-10">
          {onEdit && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="px-1.5 text-slate-600 hover:text-slate-900"
              title="Edit message"
            >
              ✎
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              onClick={() => void onDelete()}
              className="px-1.5 text-rose-600 hover:text-rose-700"
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
            : 'bg-white border border-slate-200 text-slate-800 rounded-bl-sm',
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
                mine
                  ? 'bg-brand-700/40 text-white placeholder:text-white/60'
                  : 'bg-slate-50 text-slate-800',
              )}
            />
            <div className="flex justify-end gap-1 text-[11px]">
              <button
                type="button"
                onClick={cancelEdit}
                className={clsx(
                  'px-2 py-0.5 rounded',
                  mine ? 'text-white/70 hover:text-white' : 'text-slate-500 hover:text-slate-800',
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
                    : 'bg-slate-900 text-white hover:bg-slate-800',
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
                'text-[10px] mt-1 inline-flex items-center gap-1',
                mine ? 'text-white/70' : 'text-slate-400',
              )}
            >
              {new Date(message.created_at).toLocaleTimeString([], {
                hour: 'numeric',
                minute: '2-digit',
              })}
              {message.edited_at && (
                <span className={mine ? 'text-white/60' : 'text-slate-400'}>· edited</span>
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
