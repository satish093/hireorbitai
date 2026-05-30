/**
 * WhatsApp-style full-screen voice-call UI.
 *
 * Live states (this component):
 *   ringing   — full-screen overlay with big avatar + Answer/Decline (inbound)
 *   calling   — full-screen "Calling…" with cancel (outbound, pre-answer)
 *   connected — full-screen with avatar, live timer, mute + minimize + end;
 *               a "Reconnecting…" banner overlays when the network is poor.
 *
 * Terminal state is rendered by <CallResolutionCard> (ended / declined /
 * missed) and the minimized live call by <CallPill> — both mounted by
 * CallProvider so they survive navigation.
 *
 * The remote-audio sink lives in CallProvider (not here) so it survives every
 * modal mount cycle. Portaled to document.body so the overlay is
 * viewport-relative, not relative to the transformed <main>.
 *
 * Accessibility: focus is trapped inside the overlay while open; Esc minimizes
 * a connected call (never silently hangs up); a visually-hidden live region
 * announces state changes to screen readers.
 */

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { Avatar } from './TaskBits';
import { Button } from './Button';
import { IconPhone, IconPhoneOff, IconMic, IconMicOff } from './Icons';
import type { CallStatus, CallEndReason, UseCallReturn } from '../hooks/useCall';
import { ROLE_LABEL, type Role } from '../types';

interface CallModalProps {
  status: CallStatus;
  peer: { id: string; full_name?: string | null; email: string } | null;
  incomingCall: UseCallReturn['incomingCall'];
  isMuted: boolean;
  callDurationLabel: string;
  reconnecting: boolean;
  minimized: boolean;
  /** True when browser autoplay blocked the remote stream; show "Tap to hear". */
  needsAudioTap: boolean;
  /** Relationship label (e.g. "Your assigned consultant") shown under the name. */
  relationship?: string | null;
  onAccept: () => void;
  onReject: () => void;
  onEnd: () => void;
  onToggleMute: () => void;
  onRetryPlay: () => void;
  onMinimize: () => void;
  onOpenProfile: () => void;
}

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function CallModal({
  status,
  peer,
  incomingCall,
  isMuted,
  callDurationLabel,
  reconnecting,
  minimized,
  needsAudioTap,
  relationship,
  onAccept,
  onReject,
  onEnd,
  onToggleMute,
  onRetryPlay,
  onMinimize,
  onOpenProfile,
}: CallModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  // A connected call that's been minimized hands off to <CallPill>.
  const live = status === 'ringing' || status === 'calling' || status === 'connected';
  const showOverlay = live && !(minimized && status === 'connected');

  // Focus trap + Esc handling while the overlay is up.
  useEffect(() => {
    if (!showOverlay) return;
    const node = overlayRef.current;
    node?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Esc never hangs up. On a connected call it minimizes; otherwise
        // it's a no-op so a stray keypress can't drop an incoming/outgoing call.
        if (status === 'connected') {
          e.preventDefault();
          onMinimize();
        }
        return;
      }
      if (e.key !== 'Tab' || !node) return;
      const els = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null,
      );
      if (els.length === 0) {
        e.preventDefault();
        node.focus();
        return;
      }
      const first = els[0]!;
      const last = els[els.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showOverlay, status, onMinimize]);

  if (!showOverlay) return null;

  const callerInfo = incomingCall?.caller ?? peer;
  const displayName = callerInfo?.full_name ?? callerInfo?.email ?? 'Unknown';
  const callerRole = incomingCall?.caller?.role as Role | undefined;
  const roleLabel = callerRole ? (ROLE_LABEL[callerRole] ?? callerRole) : null;

  // Screen-reader announcement for the current state.
  const announce =
    status === 'ringing'
      ? `Incoming call from ${displayName}`
      : status === 'calling'
        ? `Calling ${displayName}`
        : reconnecting
          ? 'Call reconnecting'
          : 'Call connected';

  return createPortal(
    <div
      ref={overlayRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={status === 'ringing' ? 'Incoming call' : 'Active call'}
      className={clsx(
        'fixed inset-0 z-50 flex flex-col items-center justify-between focus:outline-none',
        'bg-gradient-to-b from-slate-900 via-slate-900 to-slate-950',
        'text-white p-6 pt-16 pb-12 animate-in fade-in duration-200 safe-pt safe-pb',
      )}
    >
      {/* SR-only live region */}
      <span aria-live="assertive" className="sr-only">
        {announce}
      </span>

      {/* Top: state label + minimize (connected only) */}
      <div className="w-full">
        {status === 'connected' && (
          <button
            type="button"
            onClick={onMinimize}
            aria-label="Minimize call"
            className="absolute top-5 left-5 w-10 h-10 rounded-full grid place-items-center bg-white/10 hover:bg-white/20 text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          >
            {/* chevron-down */}
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        )}
        <div className="text-center space-y-1">
          <p
            className={clsx(
              'text-xs uppercase tracking-[0.18em] font-medium',
              reconnecting
                ? 'text-amber-300'
                : status === 'connected'
                  ? 'text-green-400'
                  : 'text-white/60',
            )}
          >
            {status === 'ringing' && 'Incoming voice call'}
            {status === 'calling' && 'Voice call'}
            {status === 'connected' && (reconnecting ? 'Reconnecting…' : 'Connected')}
          </p>
          {status === 'connected' && (
            <p className="text-3xl font-mono tabular-nums tracking-wider text-white">
              {callDurationLabel}
            </p>
          )}
          {status === 'calling' && <p className="text-sm text-white/50">Calling…</p>}
        </div>
      </div>

      {/* Middle: big avatar + name + relationship */}
      <div className="flex flex-col items-center gap-4">
        <div className="relative">
          <div
            className={clsx(
              'rounded-full ring-4 ring-white/10 shadow-2xl',
              status === 'ringing' && 'animate-pulse-slow',
            )}
          >
            <Avatar name={callerInfo?.full_name} email={callerInfo?.email ?? ''} size={140} />
          </div>
          {status === 'ringing' && (
            <>
              <span className="absolute inset-0 rounded-full ring-2 ring-green-400/60 animate-ping" />
              <span className="absolute inset-0 rounded-full ring-2 ring-green-400/30 animate-ping animation-delay-300" />
            </>
          )}
        </div>
        <div className="text-center space-y-1.5">
          <h2 className="text-2xl font-semibold text-white">{displayName}</h2>
          {(roleLabel || relationship) && (
            <div className="flex items-center justify-center gap-2 text-xs text-white/60">
              {roleLabel && (
                <span className="px-2 py-0.5 rounded-full bg-white/10">{roleLabel}</span>
              )}
              {relationship && (
                <span className="px-2 py-0.5 rounded-full bg-white/10">{relationship}</span>
              )}
            </div>
          )}
          {/* Reconnecting banner — audio may drop briefly; timer keeps running */}
          {status === 'connected' && reconnecting && (
            <div className="mt-2 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-400/15 text-amber-200 text-xs font-medium">
              <span
                className="w-1.5 h-1.5 rounded-full bg-amber-300 animate-pulse"
                aria-hidden="true"
              />
              Poor connection — reconnecting…
            </div>
          )}
          {status === 'calling' && (
            <div className="flex justify-center gap-1.5 pt-1">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="w-2 h-2 rounded-full bg-white/60 animate-bounce"
                  style={{ animationDelay: `${i * 150}ms` }}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Bottom: controls */}
      <div className="w-full max-w-md">
        {status === 'ringing' ? (
          <div className="flex items-center justify-around">
            <CallActionButton
              onClick={onReject}
              variant="reject"
              label="Decline"
              icon={<IconPhoneOff size={28} />}
            />
            <CallActionButton
              onClick={onAccept}
              variant="accept"
              label="Accept"
              icon={<IconPhone size={28} />}
            />
          </div>
        ) : status === 'calling' ? (
          <div className="flex justify-center">
            <CallActionButton
              onClick={onEnd}
              variant="reject"
              label="Cancel"
              icon={<IconPhoneOff size={28} />}
            />
          </div>
        ) : (
          <div className="flex flex-col items-center gap-5">
            {needsAudioTap && (
              <button
                type="button"
                onClick={onRetryPlay}
                className="px-4 py-2 rounded-full bg-amber-400 text-slate-900 text-sm font-semibold shadow-lg animate-pulse focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-200"
              >
                🔈 Tap to hear the other person
              </button>
            )}
            <div className="flex items-center justify-center gap-6">
              <CallToggleButton
                onClick={onToggleMute}
                active={isMuted}
                label={isMuted ? 'Unmute' : 'Mute'}
                activeIcon={<IconMicOff size={24} />}
                inactiveIcon={<IconMic size={24} />}
              />
              <CallActionButton
                onClick={onEnd}
                variant="reject"
                label="End call"
                icon={<IconPhoneOff size={28} />}
              />
              <CallToggleButton
                onClick={onMinimize}
                active={false}
                label="Minimize"
                activeIcon={<MinimizeIcon />}
                inactiveIcon={<MinimizeIcon />}
              />
            </div>
            {/* Secondary action — open the other party's profile for context */}
            {peer?.id && (
              <button
                type="button"
                onClick={onOpenProfile}
                className="text-sm text-white/70 hover:text-white underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60 rounded px-2 py-1"
              >
                Open profile
              </button>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/**
 * CallResolutionCard — terminal-state card (ended / declined / missed) with a
 * Call-back action. Rendered by CallProvider from its own `resolution` state
 * so it persists long enough to act on, independent of the call status reset.
 */
export function CallResolutionCard({
  reason,
  peerName,
  onCallBack,
  onDismiss,
}: {
  reason: CallEndReason;
  peerName: string;
  onCallBack: () => void;
  onDismiss: () => void;
}) {
  const copy: Record<CallEndReason, { icon: string; title: string }> = {
    ended: { icon: '📵', title: 'Call ended' },
    declined: { icon: '🚫', title: 'Call declined' },
    missed: { icon: '📵', title: 'Missed call' },
  };
  const { icon, title } = copy[reason];

  return createPortal(
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 w-[min(360px,calc(100vw-2rem))] animate-in fade-in slide-in-from-bottom-2 duration-200"
      style={{ bottom: 'max(24px, calc(env(safe-area-inset-bottom) + 16px))' }}
    >
      <div
        className="rounded-2xl border p-4"
        style={{
          background: 'var(--bg-elev)',
          borderColor: 'var(--border)',
          boxShadow: 'var(--shadow-pop)',
        }}
      >
        <div className="flex items-center gap-3">
          <span className="text-xl" aria-hidden="true">
            {icon}
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
              {title}
            </div>
            <div className="text-xs truncate" style={{ color: 'var(--muted)' }}>
              {peerName}
            </div>
          </div>
        </div>
        <div className="flex gap-2 mt-3">
          <Button variant="ghost" size="sm" block onClick={onDismiss}>
            Dismiss
          </Button>
          <Button variant="accent" size="sm" block onClick={onCallBack}>
            Call back
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function MinimizeIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="4 14 10 14 10 20" />
      <polyline points="20 10 14 10 14 4" />
      <line x1="14" y1="10" x2="21" y2="3" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  );
}

function CallActionButton({
  onClick,
  variant,
  label,
  icon,
}: {
  onClick: () => void;
  variant: 'accept' | 'reject';
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={clsx(
        'flex flex-col items-center gap-2 group',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60 rounded-2xl p-1',
      )}
    >
      <span
        className={clsx(
          'w-[72px] h-[72px] rounded-full flex items-center justify-center text-white',
          'shadow-2xl transition-transform group-active:scale-95',
          variant === 'accept'
            ? 'bg-green-500 hover:bg-green-400 group-hover:shadow-green-400/30'
            : 'bg-rose-600 hover:bg-rose-500 group-hover:shadow-rose-400/30',
        )}
      >
        {icon}
      </span>
      <span className="text-xs text-white/70 font-medium">{label}</span>
    </button>
  );
}

function CallToggleButton({
  onClick,
  active,
  label,
  activeIcon,
  inactiveIcon,
}: {
  onClick: () => void;
  active: boolean;
  label: string;
  activeIcon: React.ReactNode;
  inactiveIcon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex flex-col items-center gap-2 group focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60 rounded-2xl p-1"
    >
      <span
        className={clsx(
          'w-14 h-14 rounded-full flex items-center justify-center text-white transition-colors',
          active ? 'bg-white/90 text-slate-900' : 'bg-white/15 hover:bg-white/25',
        )}
      >
        {active ? activeIcon : inactiveIcon}
      </span>
      <span className="text-xs text-white/70 font-medium">{label}</span>
    </button>
  );
}
