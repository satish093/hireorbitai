import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { Avatar } from '../components/TaskBits';
import { PresenceDot, PresencePill } from '../components/PresenceDot';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
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
const THREAD_POLL_MS = 8_000;        // active thread only
const SIDEBAR_POLL_MS = 60_000;      // conversations + directory

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
      // Best-effort mark-read (no toast on failure).
      api.post(`/messages/with/${peerId}/read`).catch(() => {});
    } catch (e: any) {
      if (inflightPeerRef.current !== peerId) return;
      toast.error(e?.response?.data?.error ?? 'Failed to load thread');
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    if (!activePeerId) { setMessages([]); inflightPeerRef.current = null; return; }
    stickToBottomRef.current = true; // jump to bottom when switching threads
    loadThread(activePeerId);
  }, [activePeerId, loadThread]);

  // Two pollers: fast for the active thread, slow for the conversation list.
  // Both pause when the tab is hidden to keep idle tabs from burning rate
  // limit budget for users with many tabs open.

  // Active-thread poller — only mounted when there IS an active peer.
  useEffect(() => {
    if (!activePeerId) return;
    const t = setInterval(() => {
      if (document.hidden) return;
      loadThread(activePeerId);
    }, THREAD_POLL_MS);
    return () => clearInterval(t);
  }, [activePeerId, loadThread]);

  // Conversation list + directory poller — runs regardless of selection but
  // at a much slower cadence. The unread badge updates show up in <1 minute
  // even on the slow poll.
  useEffect(() => {
    const t = setInterval(() => {
      if (document.hidden) return;
      refresh();
    }, SIDEBAR_POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

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
      body, read_at: null,
      created_at: new Date().toISOString(),
    };
    setMessages((m) => [...m, optimistic]);
    setDraft('');
    stickToBottomRef.current = true;
    try {
      await api.post('/messages', { recipient_id: activePeerId, body });
      await loadThread(activePeerId);
      refresh();
    } catch (e: any) {
      // Roll back optimistic message.
      setMessages((m) => m.filter((x) => x.id !== optimistic.id));
      toast.error(e?.response?.data?.error ?? 'Send failed');
      setDraft(body);
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
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden h-[calc(100vh-180px)] min-h-[480px] flex">
        {/* Left: conversation list */}
        <aside className="w-72 shrink-0 border-r border-slate-200 flex flex-col bg-slate-50/50">
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
                ) : filteredDirectory.map((p) => (
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
                      <div className="text-sm text-slate-900 truncate">{p.full_name ?? p.email}</div>
                      <div className="text-[10px] uppercase tracking-wider text-slate-500">
                        {p.role && ROLE_LABEL[p.role]}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex-1 overflow-y-auto">
            {conversations.length === 0 ? (
              <p className="text-xs text-slate-400 italic px-4 py-6 text-center">
                No messages yet. Click + to start a chat.
              </p>
            ) : conversations.map((c) => {
              const active = c.peer.id === activePeerId;
              return (
                <button
                  key={c.peer.id}
                  onClick={() => setParams({ with: c.peer.id })}
                  className={clsx(
                    'w-full flex items-start gap-2.5 px-4 py-3 text-left border-b border-slate-100 hover:bg-white',
                    active && 'bg-white border-l-2 border-l-brand-500'
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
                      <span className={clsx('text-sm font-medium truncate', c.unread_count > 0 ? 'text-slate-900' : 'text-slate-800')}>
                        {c.peer.full_name ?? c.peer.email}
                      </span>
                      <span className="text-[10px] text-slate-500 shrink-0">{relative(c.last_message.created_at)}</span>
                    </div>
                    <p className={clsx('text-xs truncate mt-0.5', c.unread_count > 0 ? 'text-slate-700 font-medium' : 'text-slate-500')}>
                      {c.last_message.sender_id === profile?.id ? 'You: ' : ''}{c.last_message.body}
                    </p>
                  </div>
                </button>
              );
            })}
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
                  <div className="text-[11px] text-slate-500">{activePeer.role && ROLE_LABEL[activePeer.role]} · {activePeer.email}</div>
                </div>
              </header>

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
                        <span className="text-[10px] uppercase tracking-widest text-slate-400 bg-white border border-slate-200 px-2 py-0.5 rounded-full">{day}</span>
                      </div>
                      <div className="space-y-2">
                        {items.map((m) => (
                          <Bubble key={m.id} message={m} mine={m.sender_id === profile?.id} />
                        ))}
                      </div>
                    </div>
                  ))
                )}
                <div ref={messagesEndRef} />
              </div>

              <form
                onSubmit={(e) => { e.preventDefault(); send(); }}
                className="border-t border-slate-200 px-4 py-3 flex items-end gap-2 bg-white"
              >
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault(); send();
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
        </main>
      </div>
    </Layout>
  );
}

function Bubble({ message, mine }: { message: Message; mine: boolean }) {
  return (
    <div className={clsx('flex', mine ? 'justify-end animate-slide-in-right' : 'justify-start animate-slide-in-left')}>
      <div
        className={clsx(
          'max-w-[70%] px-3 py-2 rounded-2xl text-sm whitespace-pre-wrap break-words shadow-sm',
          mine
            ? 'bg-brand-600 text-white rounded-br-sm'
            : 'bg-white border border-slate-200 text-slate-800 rounded-bl-sm'
        )}
      >
        {message.body}
        <div className={clsx('text-[10px] mt-1', mine ? 'text-white/70' : 'text-slate-400')}>
          {new Date(message.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
        </div>
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
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
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
