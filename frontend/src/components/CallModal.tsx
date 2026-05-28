/**
 * WhatsApp-style full-screen voice-call UI.
 *
 * Four states:
 *   ringing   — full-screen overlay with big avatar + Answer/Decline (inbound)
 *   calling   — full-screen "Calling…" with cancel (outbound, pre-answer)
 *   connected — full-screen with avatar, live timer, mute + end controls
 *   ended     — brief "Call ended" banner before fading
 *
 * Critical reliability fix from the previous build:
 *   The remote audio is bound to a real <audio autoPlay> element. The earlier
 *   version reused the <video> element with `className="hidden"` for audio
 *   calls — `display:none` blocks autoplay in Safari and several Chrome
 *   versions, producing the "no voice" bug after answer/connect.
 *
 * Portaled to document.body so the fullscreen overlay is viewport-relative,
 * not relative to the transformed <main> (see frontend-responsive rules).
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { Avatar } from './TaskBits';
import { IconPhone, IconPhoneOff, IconMic, IconMicOff } from './Icons';
import type { CallStatus, UseCallReturn } from '../hooks/useCall';

interface CallModalProps {
  status: CallStatus;
  peer: { id: string; full_name?: string | null; email: string } | null;
  incomingCall: UseCallReturn['incomingCall'];
  remoteStream: MediaStream | null;
  isMuted: boolean;
  callDurationLabel: string;
  onAccept: () => void;
  onReject: () => void;
  onEnd: () => void;
  onToggleMute: () => void;
}

export function CallModal({
  status,
  peer,
  incomingCall,
  remoteStream,
  isMuted,
  callDurationLabel,
  onAccept,
  onReject,
  onEnd,
  onToggleMute,
}: CallModalProps) {
  // ---- Remote audio playback --------------------------------------------
  // Use an <audio> element (not a hidden <video>) so display: none doesn't
  // suppress audio. The element is permanently mounted at the modal root.
  //
  // Mobile autoplay reality: on iOS Safari (and some Android Chromes) the
  // browser only honours .play() when called from a LIVE user gesture. The
  // accept-call flow is async (getUserMedia → buildPC → setRemoteDescription
  // → createAnswer → POST /answer → state update → useEffect), and by the
  // time this effect runs the gesture from the Accept tap has already
  // expired. If play() rejects, we flip `needsAudioTap` so the in-call UI
  // surfaces a "Tap to hear" button that retries play() inside a fresh
  // gesture.
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const [needsAudioTap, setNeedsAudioTap] = useState(false);

  useEffect(() => {
    const el = remoteAudioRef.current;
    if (!el) {
      setNeedsAudioTap(false);
      return;
    }
    if (!remoteStream) {
      el.srcObject = null;
      setNeedsAudioTap(false);
      return;
    }
    if (el.srcObject !== remoteStream) {
      el.srcObject = remoteStream;
    }
    el.muted = false;
    el.volume = 1;
    el.play()
      .then(() => setNeedsAudioTap(false))
      .catch(() => setNeedsAudioTap(true));
  }, [remoteStream]);

  function manualPlay() {
    const el = remoteAudioRef.current;
    if (!el) return;
    el.muted = false;
    el.volume = 1;
    el.play()
      .then(() => setNeedsAudioTap(false))
      .catch(() => {
        /* still blocked — leave the button visible */
      });
  }

  if (status === 'idle') return null;

  const callerInfo = incomingCall?.caller ?? peer;
  const displayName = callerInfo?.full_name ?? callerInfo?.email ?? 'Unknown';

  // ---- State labels ------------------------------------------------------
  const stateLabel =
    status === 'ringing'
      ? 'Incoming voice call'
      : status === 'calling'
        ? 'Calling…'
        : status === 'connected'
          ? callDurationLabel
          : 'Call ended';

  return createPortal(
    <>
      {/* Always-mounted remote-audio sink — keeps audio playing across state
          transitions and is the actual fix for the no-voice bug. */}
      <audio ref={remoteAudioRef} autoPlay playsInline className="sr-only" />

      {status === 'ended' ? (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 flex items-center gap-2 bg-surface border border-border rounded-full px-4 py-2 shadow-xl animate-in fade-in duration-200">
          <span className="text-base">📵</span>
          <span className="text-sm font-medium text-ink">Call ended</span>
        </div>
      ) : (
        // Fullscreen WhatsApp-style overlay for ringing / calling / connected.
        <div
          className={clsx(
            'fixed inset-0 z-50 flex flex-col items-center justify-between',
            'bg-gradient-to-b from-slate-900 via-slate-900 to-slate-950',
            'text-white p-6 pt-16 pb-12 animate-in fade-in duration-200',
          )}
        >
          {/* Top: state label */}
          <div className="text-center space-y-1">
            <p
              className={clsx(
                'text-xs uppercase tracking-[0.18em] font-medium',
                status === 'connected' ? 'text-green-400' : 'text-white/60',
              )}
            >
              {status === 'ringing' && 'Incoming voice call'}
              {status === 'calling' && 'Voice call'}
              {status === 'connected' && 'Connected'}
            </p>
            {status === 'connected' && (
              <p className="text-3xl font-mono tabular-nums tracking-wider text-white">
                {callDurationLabel}
              </p>
            )}
            {status !== 'connected' && stateLabel && (
              <p className="text-sm text-white/50">{stateLabel}</p>
            )}
          </div>

          {/* Middle: big avatar + name */}
          <div className="flex flex-col items-center gap-5">
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
            <h2 className="text-2xl font-semibold text-white text-center">{displayName}</h2>
            {status === 'calling' && (
              <div className="flex gap-1.5 pt-1">
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
                {/* Mobile browsers (esp. iOS Safari) block autoplay when the
                    user gesture has expired by the time srcObject is attached.
                    If play() rejected, surface a button that retries inside a
                    fresh, live gesture. Vanishes silently once audio is alive. */}
                {needsAudioTap && (
                  <button
                    type="button"
                    onClick={manualPlay}
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
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>,
    document.body,
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
