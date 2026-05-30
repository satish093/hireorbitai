/**
 * Global call context.
 *
 * Wraps useCall() at the App level so the WebRTC state machine + CallModal
 * are alive regardless of which page the user is on. Incoming calls ring
 * and can be accepted/rejected from any route.
 *
 * Owns the single, always-mounted remote-audio sink. It's a <video
 * playsInline> element (not <audio>) so the iOS hardware silent switch
 * doesn't mute it. The element is rendered here, not inside CallModal, so
 * it survives every state transition — most importantly the modal mount
 * cycle that used to drop the stream.
 *
 * Presentation layer added on top of the (intentionally untouched) WebRTC
 * engine: a `minimized` flag that swaps the full-screen modal for a floating
 * CallPill so the call survives navigation, a permission-gated startCall that
 * blocks a forbidden call BEFORE it dials (mirrors the server's
 * canMessageUser), and a terminal `resolution` card (ended / declined /
 * missed) that persists long enough to act on a Call-back.
 *
 * `primeAudio()` is exposed for buttons OUTSIDE the modal to call synchronously
 * inside their click handler — captures the autoplay gesture before the multi-
 * step async call flow expires it.
 */

import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useCall, UseCallReturn, CallEndReason } from '../hooks/useCall';
import { CallModal, CallResolutionCard } from '../components/CallModal';
import { CallPill } from '../components/CallPill';
import { useAuth } from './AuthContext';
import { canMessage, relationshipLabel } from '../lib/canMessage';
import type { Role } from '../types';

interface CallContextValue extends Omit<UseCallReturn, 'startCall'> {
  /** Permission-gated dial. Pass peerRole to enable the client-side canMessage
   *  pre-check (the server enforces canMessageUser regardless). */
  startCall: (
    peerId: string,
    peerName: string | null,
    peerEmail: string,
    peerRole?: Role | null,
  ) => Promise<void>;
  /** Call inside a click handler to capture the user gesture for autoplay. */
  primeAudio: () => void;
  /** True when the browser blocked play() and the user needs to tap to unblock. */
  needsAudioTap: boolean;
  /** Retries play() inside a fresh user gesture. */
  retryPlay: () => void;
  /** Collapse the full-screen call to the floating pill (call keeps running). */
  minimize: () => void;
  /** Re-expand the floating pill back to the full-screen modal. */
  expand: () => void;
  /** True while a connected call is showing as the floating pill. */
  minimized: boolean;
}

const CallContext = createContext<CallContextValue | null>(null);

interface Resolution {
  reason: CallEndReason;
  peerId: string | null;
  peerName: string;
  peerRole: Role | null;
}

export function CallProvider({ children }: { children: ReactNode }) {
  const call = useCall();
  const { profile } = useAuth();
  const navigate = useNavigate();
  const audioElRef = useRef<HTMLVideoElement>(null);
  const [needsAudioTap, setNeedsAudioTap] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [resolution, setResolution] = useState<Resolution | null>(null);

  // Track the most recent peer + their role so the resolution card + Call-back
  // survive finalise() nulling call.peer. Covers both outbound (call.peer) and
  // inbound-never-answered (call.incomingCall.caller).
  const lastPeerRef = useRef<{ id: string; full_name?: string | null; email: string } | null>(null);
  const lastPeerRoleRef = useRef<Role | null>(null);

  useEffect(() => {
    if (call.peer) {
      lastPeerRef.current = call.peer;
    } else if (call.incomingCall?.caller) {
      const c = call.incomingCall.caller;
      lastPeerRef.current = { id: c.id, full_name: c.full_name, email: c.email };
      lastPeerRoleRef.current = (c.role as Role) ?? null;
    }
  }, [call.peer, call.incomingCall]);

  // Reset the minimized flag whenever the call is no longer live-connected.
  useEffect(() => {
    if (call.status !== 'connected') setMinimized(false);
  }, [call.status]);

  // Capture the terminal resolution when the call ends. Persists independent of
  // the engine's 2.5 s status→idle reset so the user has time to hit Call-back.
  useEffect(() => {
    if (call.status === 'ended') {
      const peer = lastPeerRef.current;
      const reason = call.endReason ?? 'ended';
      setResolution({
        reason,
        peerId: peer?.id ?? null,
        peerName: peer?.full_name ?? peer?.email ?? 'Unknown',
        peerRole: lastPeerRoleRef.current,
      });
      // A missed/declined call is easy to not notice (e.g. minimized / another
      // tab) — surface a toast in addition to the card.
      if (reason === 'missed') {
        toast(`Missed call · ${peer?.full_name ?? peer?.email ?? ''}`.trim(), { icon: '📵' });
      }
    } else if (call.status === 'calling' || call.status === 'ringing') {
      // A new call supersedes any lingering resolution card.
      setResolution(null);
    }
  }, [call.status, call.endReason]);

  function primeAudio() {
    const el = audioElRef.current;
    if (!el) return;
    el.muted = false;
    el.volume = 1;
    el.play().catch(() => {
      /* will retry once stream lands */
    });
  }

  function retryPlay() {
    const el = audioElRef.current;
    if (!el) return;
    el.muted = false;
    el.volume = 1;
    el.play()
      .then(() => setNeedsAudioTap(false))
      .catch(() => {
        /* still blocked — leave the button visible */
      });
  }

  // Permission-gated dial. The server is the source of truth (canMessageUser on
  // /calls/offer), but blocking here means a forbidden call never even rings
  // the user's own mic / shows a dialing screen.
  async function startCall(
    peerId: string,
    peerName: string | null,
    peerEmail: string,
    peerRole?: Role | null,
  ): Promise<void> {
    if (peerRole && !canMessage(profile?.role, peerRole)) {
      throw new Error("You don't have permission to call this person.");
    }
    lastPeerRoleRef.current = peerRole ?? null;
    setMinimized(false);
    return call.startCall(peerId, peerName, peerEmail);
  }

  // Surface mic / permission errors via the global toast as soon as useCall
  // sets them.
  useEffect(() => {
    if (!call.lastError) return;
    toast.error(call.lastError, { duration: 6000 });
    call.clearError();
  }, [call.lastError, call]);

  // Bind the remote stream + attempt play whenever it changes.
  useEffect(() => {
    const el = audioElRef.current;
    if (!el) return;
    if (!call.remoteStream) {
      el.srcObject = null;
      setNeedsAudioTap(false);
      return;
    }
    if (el.srcObject !== call.remoteStream) {
      el.srcObject = call.remoteStream;
    }
    el.muted = false;
    el.volume = 1;
    el.play()
      .then(() => setNeedsAudioTap(false))
      .catch(() => setNeedsAudioTap(true));
  }, [call.remoteStream]);

  const value: CallContextValue = {
    ...call,
    startCall,
    primeAudio,
    needsAudioTap,
    retryPlay,
    minimize: () => setMinimized(true),
    expand: () => setMinimized(false),
    minimized,
  };

  // Relationship label for the modal — best-effort from the known peer role.
  const peerRoleForLabel =
    (call.incomingCall?.caller?.role as Role | undefined) ?? lastPeerRoleRef.current ?? undefined;
  const relationship = peerRoleForLabel ? relationshipLabel(profile?.role, peerRoleForLabel) : null;

  function openProfile() {
    const id = call.peer?.id ?? lastPeerRef.current?.id;
    if (id) {
      setMinimized(true);
      navigate(`/users/${id}`);
    }
  }

  return (
    <CallContext.Provider value={value}>
      {children}

      {/* Always-mounted remote-audio sink (see header doc). */}
      <video
        ref={audioElRef}
        autoPlay
        playsInline
        {...({ 'webkit-playsinline': 'true' } as Record<string, string>)}
        className="sr-only"
      />

      <CallModal
        status={call.status}
        peer={call.peer}
        incomingCall={call.incomingCall}
        isMuted={call.isMuted}
        callDurationLabel={call.callDurationLabel}
        reconnecting={call.reconnecting}
        minimized={minimized}
        needsAudioTap={needsAudioTap}
        relationship={relationship}
        onAccept={() => {
          primeAudio();
          call.acceptCall();
        }}
        onReject={call.rejectCall}
        onEnd={call.endCall}
        onToggleMute={call.toggleMute}
        onRetryPlay={retryPlay}
        onMinimize={() => setMinimized(true)}
        onOpenProfile={openProfile}
      />

      {/* Minimized live call → floating pill (survives navigation). */}
      {minimized && call.status === 'connected' && (
        <CallPill
          peer={call.peer}
          callDurationLabel={call.callDurationLabel}
          reconnecting={call.reconnecting}
          onExpand={() => setMinimized(false)}
          onEnd={call.endCall}
        />
      )}

      {/* Terminal resolution card (ended / declined / missed) with Call-back. */}
      {resolution && call.status !== 'connected' && (
        <CallResolutionCard
          reason={resolution.reason}
          peerName={resolution.peerName}
          onDismiss={() => setResolution(null)}
          onCallBack={() => {
            const r = resolution;
            setResolution(null);
            if (r.peerId) {
              primeAudio();
              startCall(r.peerId, r.peerName, lastPeerRef.current?.email ?? '', r.peerRole).catch(
                (e: Error) => toast.error(e.message),
              );
            }
          }}
        />
      )}
    </CallContext.Provider>
  );
}

export function useCallContext(): CallContextValue {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error('useCallContext must be used inside <CallProvider>');
  return ctx;
}
