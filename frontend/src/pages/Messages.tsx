import { lazy, Suspense, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { Avatar } from '../components/TaskBits';
import { PresenceDot, PresencePill } from '../components/PresenceDot';
import { GroupBadge } from '../components/GroupBadge';
import { Button } from '../components/Button';
import {
  IconSearch,
  IconPhone,
  IconSend,
  IconPaperclip,
  IconX,
  IconFile,
} from '../components/Icons';
import { NotificationToggle } from '../components/NotificationToggle';
import { useMediaViewer } from '../hooks/useMediaViewer';

// Lazy-load the media viewer chunk — yet-another-react-lightbox +
// @react-pdf-viewer + pdfjs-dist together push ~600 kB. The hook above
// stays eager (just useState), so opening a chat doesn't pay the cost;
// the chunk is fetched only when the user actually clicks an attachment.
const MediaViewerModal = lazy(() => import('../components/MediaViewerModal'));
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useRealtime } from '../hooks/useRealtime';
import { useCallContext } from '../context/CallContext';
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

interface Attachment {
  id: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  download_url: string | null;
  is_image?: boolean;
  /** Local-only flag set on optimistic attachments while their upload is in flight. */
  uploading?: boolean;
  /** Local-only object URL used to preview images before the upload returns. */
  localPreview?: string;
}

interface ReplyParent {
  id: string;
  body: string;
  sender_id: string;
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
  attachments?: Attachment[];
  reply_to_message_id?: string | null;
  reply_to?: ReplyParent | null;
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
// Typing-indicator cadence + auto-clear. We ping the server at most once
// per PING window while the user is actively typing; the recipient
// silences the indicator after CLEAR ms of no follow-up event so a
// dropped "stop typing" never leaves the indicator stuck.
const TYPING_PING_MS = 2_500;
const TYPING_CLEAR_MS = 3_500;

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
  // Files the user has picked but not yet sent. Each starts uploading
  // immediately (orphan row created on the server); we only block "Send"
  // while uploads are in flight. On send we pass the server ids as
  // attachment_ids and the server claims them. Empties on send / discard.
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Belt-and-braces revoke of any localPreview object URLs that survive the
  // component unmount. Normal flow revokes inline (upload-complete / unstage
  // / send), but a route change mid-upload or a parent crash would otherwise
  // leak the blob: URLs for the lifetime of the tab. The ref keeps the
  // unmount handler reading the LATEST list rather than the initial empty
  // closure capture.
  const pendingAttachmentsRef = useRef<Attachment[]>([]);
  useEffect(() => {
    pendingAttachmentsRef.current = pendingAttachments;
  }, [pendingAttachments]);
  useEffect(() => {
    return () => {
      for (const att of pendingAttachmentsRef.current) {
        if (att.localPreview) URL.revokeObjectURL(att.localPreview);
      }
    };
  }, []);
  // Auto-grow composer textarea: re-measures on every keystroke up to ~6
  // lines, then scrolls internally. Kills the "tiny one-line box for a
  // 3-paragraph message" feeling that single-row textareas have.
  const composerRef = useRef<HTMLTextAreaElement>(null);
  // "X is typing…" indicator state for the active peer. Set when we
  // receive a message:typing SSE event from the active peer; auto-clears
  // after ~3.5s of no follow-up event. We also clear immediately when a
  // real message:new arrives from them, so the indicator doesn't flash
  // for a beat after the message lands.
  // Active reply target. Click "Reply" on a bubble to set this; the chip
  // above the composer renders the parent preview + an X to clear.
  // Cleared on send + on peer change.
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [peerTyping, setPeerTyping] = useState(false);
  const peerTypingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Local throttle so we don't POST /typing on every keystroke — once
  // every TYPING_PING_MS while text is being entered is plenty (server
  // re-fires the SSE each time; the recipient's auto-clear keeps it live).
  const lastTypingPingRef = useRef<number>(0);
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

  // Call state comes from the global CallProvider (mounted in App.tsx).
  const call = useCallContext();

  // WhatsApp/Discord-style attachment viewer. Bubble-level AttachmentView
  // calls `mediaViewer.open(message.attachments, clickedIndex)` to launch
  // the image lightbox (gallery within the same message) or PDF viewer.
  const mediaViewer = useMediaViewer();

  // True until the first /conversations + /directory pair has returned. Lets
  // the sidebar show a 3-row skeleton instead of either an empty state
  // ("No one is reachable yet…") or a totally blank rail on first paint.
  const [initialLoad, setInitialLoad] = useState(true);

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
    } finally {
      setInitialLoad(false);
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
    setReplyingTo(null); // any pending reply target belongs to the previous peer
    // Clear the previous peer's messages SYNCHRONOUSLY before kicking off the
    // new load. Without this, loadThread's "preserve missing local rows"
    // merge (which is correct for within-peer polls + SSE races) treats the
    // OLD peer's entire history as "missing" relative to the new peer's
    // snapshot and appends every old message back in — chats appear not to
    // switch, or appear interleaved with the previous thread, until the
    // next poll tick.
    setMessages([]);
    setPeerTyping(false);
    if (peerTypingTimerRef.current) {
      clearTimeout(peerTypingTimerRef.current);
      peerTypingTimerRef.current = null;
    }
    if (!activePeerId) {
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
    'message:typing': (raw) => {
      const p = (raw ?? {}) as { from_user_id?: string };
      // Only render the indicator for the open thread. Cross-thread
      // typing pings still arrive but are ignored (the conversation
      // list could surface them in a future pass — out of scope here).
      if (!activePeerId || p.from_user_id !== activePeerId) return;
      setPeerTyping(true);
      if (peerTypingTimerRef.current) clearTimeout(peerTypingTimerRef.current);
      peerTypingTimerRef.current = setTimeout(() => setPeerTyping(false), TYPING_CLEAR_MS);
    },
    'message:read': (raw) => {
      // The peer just marked our messages as read. Flip the local read_at
      // on every affected row so the WhatsApp-style ✓✓ blue tick lights
      // up instantly — without this, the sender had to wait for the next
      // poll cycle to see the read state change.
      const p = (raw ?? {}) as {
        conversation_with?: string;
        read_at?: string;
        message_ids?: string[];
      };
      if (!p.message_ids?.length) return;
      const readAt = p.read_at ?? new Date().toISOString();
      const ids = new Set(p.message_ids);
      setMessages((arr) =>
        arr.map((x) => (ids.has(x.id) && !x.read_at ? { ...x, read_at: readAt } : x)),
      );
    },
  });

  // When a real message arrives from the peer, kill the typing indicator
  // immediately — leaving "Sarah is typing…" up for half a second after
  // her message lands looks broken.
  useEffect(() => {
    if (!activePeerId) return;
    const last = messages[messages.length - 1];
    if (last?.sender_id === activePeerId) {
      setPeerTyping(false);
      if (peerTypingTimerRef.current) clearTimeout(peerTypingTimerRef.current);
    }
  }, [messages, activePeerId]);

  // Cleanup on unmount / peer change so a stale timer can't fire into a
  // dead component.
  useEffect(() => {
    return () => {
      if (peerTypingTimerRef.current) clearTimeout(peerTypingTimerRef.current);
    };
  }, []);

  // Auto-scroll only when the user is already near the bottom.
  useEffect(() => {
    if (stickToBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [messages, activePeerId]);

  // Auto-resize the composer textarea up to a max height. We reset to auto
  // first so it can shrink back down when the user deletes text.
  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = 'auto';
    // 144px ≈ 6 lines of body-1; matches the existing `max-h-32` Tailwind
    // class (8rem = 128px) plus the padding so the visual cap is the same.
    el.style.height = Math.min(el.scrollHeight, 144) + 'px';
  }, [draft]);

  function onScrollMessages() {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 80;
  }

  // Direct loading of a peer via /users/:id so the chat header renders even
  // before conversations/directory finish loading. Without this, opening
  // /messages?with=<id> from a deep link / notification shows the empty
  // "Select a conversation" state until two slow lists finish.
  const [peerFallback, setPeerFallback] = useState<Party | null>(null);
  useEffect(() => {
    // Reset SYNCHRONOUSLY on every peer change so the chat header can never
    // render the PREVIOUS peer's name/avatar/role while the new /users/:id
    // fetch is in flight (which made the inbox feel like it hadn't switched).
    setPeerFallback(null);
    if (!activePeerId) return;
    let cancelled = false;
    api
      .get(`/users/${activePeerId}`)
      .then((r) => {
        if (cancelled) return;
        const u = r.data as Partial<Party> | null;
        if (u?.id && u.id === activePeerId) setPeerFallback(u as Party);
      })
      .catch(() => {
        /* falls through to undefined header until conversations/directory load */
      });
    return () => {
      cancelled = true;
    };
  }, [activePeerId]);

  const activePeer: Party | undefined = useMemo(() => {
    if (!activePeerId) return undefined;
    return (
      conversations.find((c) => c.peer.id === activePeerId)?.peer ??
      directory.find((p) => p.id === activePeerId) ??
      peerFallback ??
      undefined
    );
  }, [activePeerId, conversations, directory, peerFallback]);

  // Pick file(s) → upload each as an orphan attachment and stage it locally.
  // We start the upload immediately so by the time the user hits Send the
  // attachment is already on disk (most cases). The Send button is disabled
  // while any staged item is still uploading.
  async function onFilesPicked(files: FileList | null) {
    if (!activePeerId || !files || files.length === 0) return;
    const list = Array.from(files);
    for (const f of list) {
      const tmp: Attachment = {
        id: `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file_name: f.name,
        mime_type: f.type || null,
        size_bytes: f.size,
        download_url: null,
        is_image: f.type.startsWith('image/'),
        uploading: true,
        localPreview: f.type.startsWith('image/') ? URL.createObjectURL(f) : undefined,
      };
      setPendingAttachments((arr) => [...arr, tmp]);
      try {
        const form = new FormData();
        form.append('file', f);
        form.append('recipient_id', activePeerId);
        const res = await api.post<Attachment>('/messages/attachments', form, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        // Swap the tmp row for the real one returned by the server.
        // Revoke the object-URL we used for the local image preview —
        // the server gives us a signed URL to display instead, and
        // leaving the blob URL around leaks memory.
        if (tmp.localPreview) URL.revokeObjectURL(tmp.localPreview);
        setPendingAttachments((arr) =>
          arr.map((a) => (a.id === tmp.id ? { ...res.data, uploading: false } : a)),
        );
      } catch (e: any) {
        if (tmp.localPreview) URL.revokeObjectURL(tmp.localPreview);
        setPendingAttachments((arr) => arr.filter((a) => a.id !== tmp.id));
        toast.error(e?.response?.data?.error ?? `Failed to upload ${f.name}`);
      }
    }
  }

  // Remove a staged attachment before sending. If it's already a real
  // server row, also delete it on the server so we don't leave an orphan.
  function unstageAttachment(att: Attachment) {
    if (att.localPreview) URL.revokeObjectURL(att.localPreview);
    setPendingAttachments((arr) => arr.filter((a) => a.id !== att.id));
    if (!att.uploading && !att.id.startsWith('tmp-')) {
      void api.delete(`/messages/attachments/${att.id}`).catch(() => {});
    }
  }

  async function send() {
    if (!activePeerId) return;
    const hasAttachments = pendingAttachments.length > 0;
    const hasBody = draft.trim().length > 0;
    if (!hasBody && !hasAttachments) return;
    // Block while uploads are in flight — server would reject those ids
    // because they're still attached to the local tmp- placeholders.
    if (pendingAttachments.some((a) => a.uploading)) {
      toast('Hold on — one of your files is still uploading.', { icon: '⏳' });
      return;
    }
    setSending(true);
    const body = draft;
    const stagedAttachments = pendingAttachments;
    const stagedReply = replyingTo;
    tmpIdRef.current += 1;
    const optimistic: Message = {
      id: `tmp-${Date.now()}-${tmpIdRef.current}`,
      sender_id: profile?.id ?? '',
      recipient_id: activePeerId,
      body,
      read_at: null,
      created_at: new Date().toISOString(),
      attachments: stagedAttachments,
      reply_to_message_id: stagedReply?.id ?? null,
      reply_to: stagedReply
        ? { id: stagedReply.id, body: stagedReply.body, sender_id: stagedReply.sender_id }
        : null,
    };
    setMessages((m) => [...m, optimistic]);
    setDraft('');
    setPendingAttachments([]);
    setReplyingTo(null);
    stickToBottomRef.current = true;
    try {
      // The server fans out a message:new SSE to both ends, so by the
      // time this resolves the SSE may have ALREADY swapped the tmp-
      // row for the real one (see the 'message:new' handler's
      // "SSE beat the POST response" branch). Be idempotent: if a row
      // with the saved id is already present, drop the tmp- row and
      // leave the SSE-delivered one in place. Otherwise do the swap.
      const res = await api.post('/messages', {
        recipient_id: activePeerId,
        body,
        attachment_ids: stagedAttachments.filter((a) => !a.id.startsWith('tmp-')).map((a) => a.id),
        reply_to_message_id: stagedReply?.id ?? null,
      });
      const saved = res.data as Message;
      setMessages((m) => {
        if (m.some((x) => x.id === saved.id)) {
          return m.filter((x) => x.id !== optimistic.id);
        }
        return m.map((x) => (x.id === optimistic.id ? saved : x));
      });
      refresh();
    } catch (e: any) {
      // Roll back optimistic message + restore the staged attachments
      // so the user can retry without re-uploading. The orphans are
      // still on the server and re-claimable.
      setMessages((m) => m.filter((x) => x.id !== optimistic.id));
      setPendingAttachments(stagedAttachments);
      if (e?.response?.status === 403) {
        setAccessDenied(true);
        toast.error('You can no longer message this user.');
        setDraft('');
        setPendingAttachments([]);
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
            {initialLoad && conversations.length === 0 && directory.length === 0 ? (
              <div className="px-3 py-2 space-y-2" aria-label="Loading conversations">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="flex items-center gap-3 px-1 py-2 animate-pulse">
                    <div className="w-11 h-11 rounded-full bg-hover" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-3 rounded bg-hover w-3/4" />
                      <div className="h-2.5 rounded bg-hover/70 w-1/2" />
                    </div>
                  </div>
                ))}
              </div>
            ) : filteredConversations.length === 0 && filteredDirectory.length === 0 ? (
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
                            {previewForConversation(c.last_message)}
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
                {/* Voice call — disabled while already in a call */}
                <div className="ml-auto flex items-center gap-1 text-muted">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    iconOnly
                    leftIcon={<IconPhone size={18} />}
                    title="Voice call"
                    disabled={call.status !== 'idle'}
                    onClick={() => {
                      // Capture user gesture for autoplay BEFORE the async
                      // startCall chain expires it. Critical for iOS Safari
                      // and some Android Chromes — without this, the callee
                      // answers but no audio plays until the user taps
                      // "Tap to hear" inside the call screen.
                      call.primeAudio();
                      call
                        .startCall(activePeer.id, activePeer.full_name ?? null, activePeer.email)
                        .catch((e: Error) => toast.error(e.message));
                    }}
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
                          <div>
                            {annotateBursts(items).map(({ msg: m, isHeadOfBurst }) => (
                              <Bubble
                                key={m.id}
                                message={m}
                                mine={m.sender_id === profile?.id}
                                isHeadOfBurst={isHeadOfBurst}
                                peerName={activePeer?.full_name?.trim() || activePeer?.email}
                                onOpenMedia={mediaViewer.open}
                                onReply={() => {
                                  setReplyingTo(m);
                                  composerRef.current?.focus();
                                }}
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

                  {/* Reply-target preview chip — shown while the user is
                      composing a reply. The chip identifies the parent
                      message author + a short preview of the body, with
                      an X to clear. Submitting the message clears
                      replyingTo automatically. */}
                  {replyingTo && (
                    <div className="border-t border-border px-5 py-2 bg-surface flex items-start gap-2">
                      <div className="flex-1 min-w-0 border-l-2 border-brand-500 pl-2">
                        <div className="text-[10px] uppercase tracking-widest text-muted">
                          Replying to{' '}
                          <span className="text-ink font-semibold">
                            {replyingTo.sender_id === profile?.id
                              ? 'yourself'
                              : (activePeer?.full_name?.trim() ?? activePeer?.email ?? 'them')}
                          </span>
                        </div>
                        <div className="text-xs text-ink-2 truncate">
                          {replyingTo.body || (
                            <em className="text-muted">
                              {replyingTo.attachments?.length
                                ? `📎 ${replyingTo.attachments[0]!.file_name}`
                                : 'message'}
                            </em>
                          )}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setReplyingTo(null)}
                        aria-label="Cancel reply"
                        title="Cancel reply"
                        className="shrink-0 h-6 w-6 inline-flex items-center justify-center rounded text-muted hover:text-ink hover:bg-hover"
                      >
                        <IconX size={14} />
                      </button>
                    </div>
                  )}
                  {/* Typing indicator — only visible to the recipient of
                      a freshly-typed character. Auto-clears after
                      TYPING_CLEAR_MS or as soon as a real message:new
                      arrives from the peer (see the useEffect on
                      messages above). Sits flush above the composer so
                      it doesn't push the chat history. */}
                  {peerTyping && activePeer && (
                    <div className="border-t border-border px-5 py-1.5 bg-surface text-[11px] text-muted flex items-center gap-1.5">
                      <TypingDots />
                      <span>{activePeer.full_name?.trim() || activePeer.email} is typing…</span>
                    </div>
                  )}
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      send();
                    }}
                    className={clsx('bg-surface', peerTyping ? '' : 'border-t border-border')}
                  >
                    {/* Staged-attachments strip — shown above the composer
                        while files are pending. Image attachments show a
                        small thumb; everything else gets a filename chip.
                        Click the X to remove before sending. */}
                    {pendingAttachments.length > 0 && (
                      <div className="px-3 pt-3 flex flex-wrap gap-2 border-b border-border">
                        {pendingAttachments.map((a) => (
                          <AttachmentChip
                            key={a.id}
                            attachment={a}
                            onRemove={() => unstageAttachment(a)}
                          />
                        ))}
                      </div>
                    )}
                    <div className="px-3 py-3 flex items-end gap-2">
                      <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        className="hidden"
                        onChange={(e) => {
                          void onFilesPicked(e.target.files);
                          // Reset so picking the same file twice re-fires onChange.
                          e.target.value = '';
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        title="Attach a file"
                        aria-label="Attach a file"
                        className="shrink-0 h-10 w-10 flex items-center justify-center rounded-full text-muted hover:text-ink hover:bg-hover transition-colors"
                      >
                        <IconPaperclip size={18} />
                      </button>
                      <textarea
                        ref={composerRef}
                        value={draft}
                        onChange={(e) => {
                          setDraft(e.target.value);
                          // Throttled typing-ping: at most once per
                          // TYPING_PING_MS while the field is non-empty.
                          // The recipient's auto-clear keeps the indicator
                          // live; we don't need to fire a "stopped typing"
                          // explicitly. Tolerates network errors silently
                          // (typing indicator is best-effort UX).
                          if (!activePeerId || !e.target.value.trim()) return;
                          const now = Date.now();
                          if (now - lastTypingPingRef.current < TYPING_PING_MS) return;
                          lastTypingPingRef.current = now;
                          api.post(`/messages/with/${activePeerId}/typing`).catch(() => {});
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            send();
                          }
                        }}
                        rows={1}
                        placeholder="Write a message… (Shift+Enter for newline)"
                        className="flex-1 resize-none bg-hover/60 rounded-2xl px-4 py-2.5 text-sm text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand-500/40 max-h-36 overflow-y-auto"
                      />
                      <Button
                        type="submit"
                        variant="primary"
                        iconOnly
                        leftIcon={<IconSend size={18} />}
                        disabled={
                          sending ||
                          (!draft.trim() && pendingAttachments.length === 0) ||
                          pendingAttachments.some((a) => a.uploading)
                        }
                        loading={sending}
                        title="Send message"
                        className="shrink-0 !rounded-full !w-10 !h-10"
                      />
                    </div>
                  </form>
                </>
              )}
            </>
          )}
        </main>
      </div>

      {/* WhatsApp/Discord-style attachment viewer — portaled, ESC + click-
          outside close. Image lightbox for image attachments, in-app PDF
          viewer for PDFs, file card for anything else. Mounted ONCE at
          page-level so it survives bubble re-renders and the SSE / poll
          message merges don't tear it down mid-view.
          Lazy-loaded — Suspense fallback is null because the viewer chunk
          only loads on the first click anyway; a brief flash to load the
          ~200 kB gzipped chunk is invisible against the click handler. */}
      {mediaViewer.state && (
        <Suspense fallback={null}>
          <MediaViewerModal state={mediaViewer.state} onClose={mediaViewer.close} />
        </Suspense>
      )}
    </Layout>
  );
}

function Bubble({
  message,
  mine,
  isHeadOfBurst = true,
  peerName,
  onReply,
  onEdit,
  onDelete,
  onOpenMedia,
}: {
  message: Message;
  mine: boolean;
  /** True when this is the first message in a burst from this sender — gets
   *  more top-margin so consecutive messages from one sender visually stack
   *  tight (the "Discord/Slack" look). Defaults to true for callers that
   *  haven't been updated to pass the flag. */
  isHeadOfBurst?: boolean;
  /** Display name for the peer — used to label the quoted reply preview
   *  ("Replying to Sarah") when the parent's sender isn't me. */
  peerName?: string | null;
  onReply?: () => void;
  onEdit?: (newBody: string) => void | Promise<void>;
  onDelete?: () => void | Promise<void>;
  /** Opens the centered MediaViewerModal (image lightbox or PDF). The
   *  bubble passes its OWN attachments list + the clicked index so the
   *  lightbox can navigate across all images in the same message. */
  onOpenMedia?: (attachments: NonNullable<Message['attachments']>, startIndex: number) => void;
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
        // Tight stack: a continuation message sits ~2px below the previous
        // one in the same burst; a new burst gets ~10px of breathing room.
        isHeadOfBurst ? 'mt-2.5' : 'mt-0.5',
        mine ? 'justify-end animate-slide-in-right' : 'justify-start animate-slide-in-left',
      )}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Hover menu. Reply is available on every message; edit/delete only
          for own messages. Positioned above the bubble so it doesn't
          overlap the message text. */}
      {hovered && !editing && (onReply || (mine && (onEdit || onDelete))) && (
        <div
          className={clsx(
            'absolute -top-3 inline-flex gap-1 bg-surface border border-border rounded-full shadow-sm px-1 py-0.5 text-[11px] z-10',
            mine ? 'right-1' : 'left-1',
          )}
        >
          {onReply && (
            <button
              type="button"
              onClick={onReply}
              className="px-1.5 text-muted hover:text-ink"
              title="Reply"
              aria-label="Reply"
            >
              ↩
            </button>
          )}
          {mine && onEdit && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="px-1.5 text-muted hover:text-ink"
              title="Edit message"
            >
              ✎
            </button>
          )}
          {mine && onDelete && (
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
            {/* Reply quote — sits at the very top so the reader sees what
                this message is responding to before the body itself. The
                parent author is "you" when the parent's sender_id matches
                the viewer, otherwise it's the peer's name (passed in via
                peerName, since we don't have a full users map here). */}
            {message.reply_to && (
              <div
                className={clsx(
                  'mb-1.5 rounded-md border-l-2 pl-2 pr-2 py-1 text-[11px] max-w-full overflow-hidden',
                  mine
                    ? 'bg-white/10 border-white/40 text-white/85'
                    : 'bg-hover/60 border-brand-500 text-ink-2',
                )}
              >
                <div className={clsx('font-semibold', mine ? 'text-white/90' : 'text-brand-700')}>
                  {message.reply_to.sender_id === message.sender_id
                    ? mine
                      ? 'You'
                      : (peerName ?? 'Them')
                    : mine
                      ? (peerName ?? 'Them')
                      : 'You'}
                </div>
                <div className="truncate">{message.reply_to.body}</div>
              </div>
            )}
            {/* Attachments render ABOVE the text body so an image-only
                message reads top-down (preview → caption). Empty body
                means no separator div needed. */}
            {message.attachments && message.attachments.length > 0 && (
              <div className={clsx('flex flex-col gap-1.5', message.body ? 'mb-1.5' : '')}>
                {message.attachments.map((a, idx) => (
                  <AttachmentView
                    key={a.id}
                    attachment={a}
                    mine={mine}
                    onOpen={
                      onOpenMedia ? () => onOpenMedia(message.attachments ?? [], idx) : undefined
                    }
                  />
                ))}
              </div>
            )}
            {message.body && <span>{message.body}</span>}
            <div
              // text-white/90 over bg-brand-600 = ~5.0:1, meeting WCAG AA's
              // 4.5:1 minimum for normal text. Previously text-white/70
              // landed at 3.92:1 and tripped axe-core color-contrast.
              className={clsx(
                'text-[10px] mt-1 flex items-center gap-1 justify-end',
                mine ? 'text-white/90' : 'text-muted',
              )}
            >
              {new Date(message.created_at).toLocaleTimeString([], {
                hour: 'numeric',
                minute: '2-digit',
              })}
              {message.edited_at && (
                <span className={mine ? 'text-white/80' : 'text-muted'}>· edited</span>
              )}
              {/* WhatsApp-style delivery ticks — outgoing messages only.
                  Sent (single grey tick) when the row exists. Read (double
                  blue tick) once the recipient's mark-read fires and
                  read_at is set. Skipped for tmp-id optimistic rows that
                  haven't reached the server yet — they'd otherwise show
                  a "sent" indicator before the network even resolves. */}
              {mine && !message.id.startsWith('tmp-') && <DeliveryTicks read={!!message.read_at} />}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Three-dot bouncing animation for the "X is typing…" indicator. Plain CSS
// (no extra dep) — three spans with a shared @keyframes that runs at the
// same 1.4s cycle but staggered by 0.2s each.
// ─────────────────────────────────────────────────────────────────────────────
function TypingDots() {
  return (
    <>
      <style>{`
        @keyframes ho-typing-bounce {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.45; }
          30%           { transform: translateY(-2px); opacity: 1; }
        }
        .ho-typing-dot {
          display: inline-block;
          width: 4px;
          height: 4px;
          margin-right: 2px;
          border-radius: 50%;
          background: currentColor;
          animation: ho-typing-bounce 1.4s infinite ease-in-out;
        }
        .ho-typing-dot:nth-child(2) { animation-delay: 0.2s; }
        .ho-typing-dot:nth-child(3) { animation-delay: 0.4s; }
      `}</style>
      <span aria-hidden className="inline-flex items-center">
        <span className="ho-typing-dot" />
        <span className="ho-typing-dot" />
        <span className="ho-typing-dot" />
      </span>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// WhatsApp-style delivery ticks. The bubble already gates this to outgoing
// messages with a real server id, so by definition the row has been
// persisted — that earns the single "sent" tick. `read_at` flipping
// non-null is what earns the second, blue tick. We deliberately skip the
// middle "delivered to recipient device" state — the backend doesn't track
// it and conflating delivered with read would be misleading. Two states is
// enough to read at a glance.
// ─────────────────────────────────────────────────────────────────────────────
function DeliveryTicks({ read }: { read: boolean }) {
  // Two overlapping ticks at 12px — the second one shifted right by 4px
  // gives the classic WhatsApp double-check silhouette without needing a
  // multi-path SVG.
  const colour = read ? '#34b7f1' : 'currentColor';
  const tick = (offset: number) => (
    <svg
      width={12}
      height={12}
      viewBox="0 0 16 16"
      fill="none"
      stroke={colour}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ position: 'absolute', left: offset }}
      aria-hidden
    >
      <path d="M3 8.5 6.5 12 14 4" />
    </svg>
  );
  return (
    <span
      // role="img" makes the bare <span> a valid host for aria-label per
      // the axe-core `aria-prohibited-attr` rule. The ticks are decorative-
      // with-meaning (a status icon), so the image role is the right fit.
      role="img"
      className="relative inline-block"
      style={{ width: 16, height: 12 }}
      title={read ? 'Read' : 'Sent'}
      aria-label={read ? 'Read' : 'Sent'}
    >
      {tick(0)}
      {read && tick(4)}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Attachment renderers (composer chip + bubble view).
// ─────────────────────────────────────────────────────────────────────────────

function formatBytes(n: number | null | undefined): string {
  if (!n || n <= 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Composer-strip chip — image thumb or filename tag, with an X to remove. */
function AttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: Attachment;
  onRemove: () => void;
}) {
  const previewSrc = attachment.localPreview ?? attachment.download_url ?? undefined;
  return (
    <div
      className={clsx(
        'relative shrink-0 inline-flex items-center gap-2 rounded-lg border border-border bg-hover/60 pl-2 pr-7 py-1.5 max-w-[240px]',
        attachment.uploading && 'opacity-70',
      )}
    >
      {attachment.is_image && previewSrc ? (
        <img
          src={previewSrc}
          alt={attachment.file_name}
          className="h-10 w-10 object-cover rounded"
        />
      ) : (
        <IconFile size={20} className="text-muted shrink-0" />
      )}
      <div className="min-w-0">
        <div className="text-xs text-ink truncate max-w-[160px]">{attachment.file_name}</div>
        <div className="text-[10px] text-muted">
          {attachment.uploading ? 'Uploading…' : formatBytes(attachment.size_bytes)}
        </div>
      </div>
      <button
        type="button"
        onClick={onRemove}
        title="Remove"
        aria-label="Remove attachment"
        className="absolute top-1 right-1 h-5 w-5 inline-flex items-center justify-center rounded-full text-muted hover:text-ink hover:bg-surface"
      >
        <IconX size={12} />
      </button>
    </div>
  );
}

/** Bubble-side attachment view — inline image preview for image MIMEs,
 *  otherwise a clickable file row with name + size.
 *
 *  If `onOpen` is provided, clicking the preview opens the WhatsApp-style
 *  centered MediaViewerModal (image lightbox, PDF viewer, or file card)
 *  instead of dumping the user into a new tab. Falls back to a plain
 *  download link if no handler — keeps the chip functional when the modal
 *  isn't mounted (older callers, SSR snapshot, etc.).
 */
function AttachmentView({
  attachment,
  mine,
  onOpen,
}: {
  attachment: Attachment;
  mine: boolean;
  onOpen?: () => void;
}) {
  const previewSrc = attachment.localPreview ?? attachment.download_url ?? undefined;
  const isPdf =
    attachment.mime_type === 'application/pdf' ||
    attachment.file_name.toLowerCase().endsWith('.pdf');

  // Inline image preview — click opens the lightbox (gallery of images in
  // the same message). Optimistic local-preview rows (no download_url yet)
  // still render the local blob: thumbnail; clicking is a no-op until the
  // upload completes.
  if (attachment.is_image && previewSrc) {
    if (onOpen && attachment.download_url) {
      return (
        <button
          type="button"
          onClick={onOpen}
          className="block max-w-[280px] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60 rounded-lg"
          title={`Open ${attachment.file_name}`}
        >
          <img
            src={previewSrc}
            alt={attachment.file_name}
            className="rounded-lg max-h-64 max-w-full object-contain bg-black/5"
          />
        </button>
      );
    }
    return (
      <img
        src={previewSrc}
        alt={attachment.file_name}
        className="block max-w-[280px] max-h-64 rounded-lg object-contain bg-black/5"
      />
    );
  }

  // Non-image (PDF / docx / xlsx / zip / …). PDFs open the in-app viewer;
  // everything else opens the FileCard modal which has Open + Close.
  const card = (
    <div
      className={clsx(
        'inline-flex items-center gap-2 rounded-lg px-2.5 py-1.5 max-w-[260px]',
        mine ? 'bg-white/15' : 'bg-hover/80',
      )}
    >
      <IconFile size={20} className={mine ? 'text-white/80' : 'text-muted'} />
      <div className="min-w-0">
        <div
          className={clsx(
            'text-xs truncate max-w-[180px] font-medium',
            mine ? 'text-white' : 'text-ink',
          )}
        >
          {attachment.file_name}
          {isPdf && <span className="ml-1 opacity-70">· PDF</span>}
        </div>
        <div className={clsx('text-[10px]', mine ? 'text-white/70' : 'text-muted')}>
          {attachment.uploading ? 'Uploading…' : formatBytes(attachment.size_bytes)}
        </div>
      </div>
    </div>
  );

  if (!attachment.download_url) return card;
  if (onOpen) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60 rounded-lg"
        title={`Open ${attachment.file_name}`}
      >
        {card}
      </button>
    );
  }
  // No viewer wired — fall back to a plain download link so the chip
  // still does *something* on click.
  return (
    <a href={attachment.download_url} target="_blank" rel="noopener noreferrer" download>
      {card}
    </a>
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

/** Window within which two consecutive messages from the same sender count
 *  as the same "burst" — gets the tight-stacked treatment (no avatar repeat,
 *  minimal vertical gap). Five minutes matches Discord's default. */
const GROUP_BURST_MS = 5 * 60_000;

/** For each message decide whether it's the first in a new burst from a
 *  given sender. The first message in a day is always a burst-head; the
 *  rest depend on prev.sender vs current.sender and the time gap. */
function annotateBursts(items: Message[]): Array<{ msg: Message; isHeadOfBurst: boolean }> {
  const out: Array<{ msg: Message; isHeadOfBurst: boolean }> = [];
  for (let i = 0; i < items.length; i++) {
    const cur = items[i]!;
    const prev = i > 0 ? items[i - 1] : null;
    const isHead =
      !prev ||
      prev.sender_id !== cur.sender_id ||
      new Date(cur.created_at).getTime() - new Date(prev.created_at).getTime() > GROUP_BURST_MS;
    out.push({ msg: cur, isHeadOfBurst: isHead });
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

/**
 * Conversation-list preview text. Falls back to an attachment-shaped label
 * when the body is empty but the message has attachments — without this, the
 * sidebar would render a blank preview for image / file-only messages.
 */
function previewForConversation(m: Message): string {
  if (m.body && m.body.trim()) return m.body;
  const atts = m.attachments ?? [];
  if (atts.length === 0) return m.body ?? '';
  const images = atts.filter((a) => a.is_image).length;
  const files = atts.length - images;
  if (images > 0 && files === 0) return images === 1 ? 'Photo' : `${images} photos`;
  if (files > 0 && images === 0)
    return files === 1 ? `${atts[0]?.file_name ?? 'File'}` : `${files} files`;
  return `${atts.length} attachments`;
}
