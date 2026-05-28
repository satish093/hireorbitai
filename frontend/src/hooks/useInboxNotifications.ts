/**
 * Discord-style inbox notifications.
 *
 * Builds on the existing realtime + unread-count plumbing:
 *   • Sidebar already polls /messages/unread-count + listens for
 *     invalidate('messages').
 *   • RealtimeNotifications already shows a react-hot-toast on every
 *     incoming message:new.
 *
 * What this hook adds (the "Discord" feel):
 *   1. Document title prefix — `(3) HireOrbit AI` when unread > 0.
 *   2. Favicon dot — a small red badge painted onto the existing SVG
 *      favicon when unread > 0.
 *   3. Browser Notification — fired ONLY when the tab is hidden AND
 *      the user has granted permission. Opt-in via requestPermission()
 *      exported below; the hook never auto-prompts.
 *   4. Sound — a short Web Audio beep when a message arrives and the
 *      tab is hidden. Opt-in via `notify:sound` localStorage flag
 *      (default off — Discord plays sound by default but our users
 *      asked for it, so we default OFF and let them toggle on).
 *
 * The hook owns its own SSE handler for message:new (separate from
 * RealtimeNotifications) so the two pieces of UX — toast vs.
 * native-notification + sound — can be reasoned about independently.
 *
 * Mount once at the App level. Re-mounting it elsewhere would double-fire
 * the desktop notification.
 */

import { useEffect, useRef } from 'react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useRealtime } from './useRealtime';
import { useInvalidationListener } from './useInvalidate';

const BASE_TITLE = 'HireOrbit AI';
const POLL_MS = 60_000;
const SOUND_PREF_KEY = 'notify:sound';

interface IncomingMessage {
  sender_id?: string;
  recipient_id?: string;
  sender?: { full_name?: string | null; email?: string | null } | null;
  body?: string | null;
}

/** Read the user's "play sound on new message" preference. Default false. */
export function getNotifySoundPref(): boolean {
  try {
    return localStorage.getItem(SOUND_PREF_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setNotifySoundPref(on: boolean): void {
  try {
    localStorage.setItem(SOUND_PREF_KEY, on ? 'true' : 'false');
  } catch {
    /* private mode / disabled storage — silently no-op */
  }
}

/** Native browser Notification permission state. Safe-to-call in SSR (returns 'unsupported'). */
export function getNotificationPermission(): 'granted' | 'denied' | 'default' | 'unsupported' {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission as 'granted' | 'denied' | 'default';
}

/** Ask the browser for notification permission. Resolves to the new state. */
export async function requestNotificationPermission(): Promise<
  'granted' | 'denied' | 'default' | 'unsupported'
> {
  if (typeof Notification === 'undefined') return 'unsupported';
  if (Notification.permission === 'granted' || Notification.permission === 'denied') {
    return Notification.permission;
  }
  return (await Notification.requestPermission()) as 'granted' | 'denied' | 'default';
}

// ─────────────────────────────────────────────────────────────────────────────
// Title-bar count
// ─────────────────────────────────────────────────────────────────────────────
function applyTitleCount(count: number): void {
  if (typeof document === 'undefined') return;
  document.title = count > 0 ? `(${count > 99 ? '99+' : count}) ${BASE_TITLE}` : BASE_TITLE;
}

// ─────────────────────────────────────────────────────────────────────────────
// Favicon dot. The base /favicon.svg is the brand mark; we draw it onto a
// canvas with a red circle overlay, then swap the <link rel="icon"> href to a
// data: URL. Cached after first paint per unique count tier (0 or 1+).
// ─────────────────────────────────────────────────────────────────────────────
let cachedClean: string | null = null;
let cachedBadge: string | null = null;
let baseFaviconHref: string | null = null;

async function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function paintFavicon(badge: boolean): Promise<string | null> {
  if (typeof document === 'undefined') return null;
  if (badge && cachedBadge) return cachedBadge;
  if (!badge && cachedClean) return cachedClean;
  try {
    if (!baseFaviconHref) {
      const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
      baseFaviconHref = link?.href ?? '/favicon.svg';
    }
    const img = await loadImage(baseFaviconHref);
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, size, size);
    if (badge) {
      // Red dot, top-right quadrant. Matches Discord's pill shape — circle
      // with a subtle dark outline so it reads on any favicon background.
      const r = 20;
      const cx = size - r - 2;
      const cy = r + 2;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = '#ef4444';
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#0b0c10';
      ctx.stroke();
    }
    const data = canvas.toDataURL('image/png');
    if (badge) cachedBadge = data;
    else cachedClean = data;
    return data;
  } catch {
    return null;
  }
}

async function applyFaviconBadge(showBadge: boolean): Promise<void> {
  if (typeof document === 'undefined') return;
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) return;
  const url = await paintFavicon(showBadge);
  if (url) link.href = url;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sound — Web Audio synth so we don't ship a binary asset.
// A two-tone "ding" (D5 → A5), 180ms total, gentle.
// ─────────────────────────────────────────────────────────────────────────────
let audioCtx: AudioContext | null = null;
function playDing(): void {
  try {
    const W = window as unknown as {
      AudioContext?: typeof AudioContext;
      webkitAudioContext?: typeof AudioContext;
    };
    const Ctor = W.AudioContext ?? W.webkitAudioContext;
    if (!Ctor) return;
    if (!audioCtx) audioCtx = new Ctor();
    const ctx = audioCtx;
    const now = ctx.currentTime;
    const tones = [
      { freq: 587.33, start: 0, dur: 0.09 }, // D5
      { freq: 880.0, start: 0.07, dur: 0.12 }, // A5
    ];
    for (const t of tones) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = t.freq;
      const attack = 0.005;
      const peak = 0.12;
      gain.gain.setValueAtTime(0, now + t.start);
      gain.gain.linearRampToValueAtTime(peak, now + t.start + attack);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + t.start + t.dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + t.start);
      osc.stop(now + t.start + t.dur);
    }
  } catch {
    /* AudioContext blocked (no user gesture yet) — silently no-op */
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The hook
// ─────────────────────────────────────────────────────────────────────────────
export function useInboxNotifications(): void {
  const { profile } = useAuth();
  // Mirror the latest unread count into a ref so the realtime handler can
  // read it without re-subscribing on every count change.
  const unreadRef = useRef<number>(0);
  const myIdRef = useRef<string | null>(null);
  myIdRef.current = profile?.id ?? null;

  // ── Poll unread count + apply title/favicon ──
  useEffect(() => {
    if (!profile?.id) {
      applyTitleCount(0);
      void applyFaviconBadge(false);
      unreadRef.current = 0;
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const apply = (count: number) => {
      unreadRef.current = count;
      applyTitleCount(count);
      void applyFaviconBadge(count > 0);
    };

    const tick = async () => {
      try {
        const r = await api.get<{ unread?: number }>('/messages/unread-count');
        if (cancelled) return;
        apply(r.data?.unread ?? 0);
      } catch {
        /* network blip — keep previous count, retry next tick */
      } finally {
        if (!cancelled) timer = setTimeout(tick, POLL_MS);
      }
    };

    void tick();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      apply(0);
    };
  }, [profile?.id]);

  // Instant refresh when RealtimeNotifications fires invalidate('messages').
  useInvalidationListener('messages', () => {
    if (!profile?.id) return;
    api
      .get<{ unread?: number }>('/messages/unread-count')
      .then((r) => {
        const c = r.data?.unread ?? 0;
        unreadRef.current = c;
        applyTitleCount(c);
        void applyFaviconBadge(c > 0);
      })
      .catch(() => {});
  });

  // ── Desktop notification + sound on incoming message ──
  useRealtime({
    'message:new': (payload) => {
      const m = (payload ?? {}) as IncomingMessage;
      const myId = myIdRef.current;
      if (!myId || m.sender_id === myId || m.recipient_id !== myId) return;

      // Only ding/notify when the tab isn't focused — Discord's exact rule.
      // The in-tab toast in RealtimeNotifications already covers the
      // foreground case.
      if (typeof document !== 'undefined' && !document.hidden) return;

      const who = m.sender?.full_name?.trim() || m.sender?.email || 'New message';
      const body = (m.body ?? '').slice(0, 140);

      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        try {
          // `tag` collapses multiple notifications from the same sender to a
          // single popup — Discord's exact behaviour. `silent` lets the
          // browser-rendered notification ride along with our own Web Audio
          // ding when sound is muted.
          const n = new Notification(who, {
            body,
            icon: '/favicon.svg',
            tag: `msg-${m.sender_id ?? 'unknown'}`,
            silent: !getNotifySoundPref(),
          });
          n.onclick = () => {
            window.focus();
            window.location.href = m.sender_id ? `/messages?with=${m.sender_id}` : '/messages';
            n.close();
          };
        } catch {
          /* notification API failed — silently no-op */
        }
      }

      if (getNotifySoundPref()) playDing();
    },
  });
}
