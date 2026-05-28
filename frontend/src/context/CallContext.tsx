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
 * `primeAudio()` is exposed for buttons OUTSIDE the modal (e.g. the 📞
 * call button in Messages) to call synchronously inside their click
 * handler. That captures the user gesture for autoplay before the multi-
 * step async call flow expires it.
 */

import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { useCall, UseCallReturn } from '../hooks/useCall';
import { CallModal } from '../components/CallModal';

interface CallContextValue extends UseCallReturn {
  /** Call inside a click handler to capture the user gesture for autoplay. */
  primeAudio: () => void;
  /** True when the browser blocked play() and the user needs to tap to unblock. */
  needsAudioTap: boolean;
  /** Retries play() inside a fresh user gesture. */
  retryPlay: () => void;
}

const CallContext = createContext<CallContextValue | null>(null);

export function CallProvider({ children }: { children: ReactNode }) {
  const call = useCall();
  const audioElRef = useRef<HTMLVideoElement>(null);
  const [needsAudioTap, setNeedsAudioTap] = useState(false);

  // Prime the element inside a live user gesture. Empty play() is fine and
  // is the standard iOS workaround — captures autoplay permission so the
  // later srcObject bind plays without restriction.
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

  const value: CallContextValue = { ...call, primeAudio, needsAudioTap, retryPlay };

  return (
    <CallContext.Provider value={value}>
      {children}

      {/* Always-mounted remote-audio sink.
          Why <video> instead of <audio>:
            • iOS hardware silent switch mutes <audio> but NOT
              <video playsInline> (same trick Google Meet uses).
          Why sr-only (NOT display:none):
            • display:none suppresses media playback in Safari + some Chromes.
              sr-only positions off-screen but keeps the element in the
              layout/playback tree.
          webkit-playsinline is a non-standard fallback for older iOS. */}
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
        needsAudioTap={needsAudioTap}
        onAccept={() => {
          primeAudio();
          call.acceptCall();
        }}
        onReject={call.rejectCall}
        onEnd={call.endCall}
        onToggleMute={call.toggleMute}
        onRetryPlay={retryPlay}
      />
    </CallContext.Provider>
  );
}

export function useCallContext(): CallContextValue {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error('useCallContext must be used inside <CallProvider>');
  return ctx;
}
