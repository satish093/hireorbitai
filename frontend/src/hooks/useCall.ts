/**
 * Voice-call WebRTC state machine.
 *
 * Signaling flows through the existing SSE channel:
 *   caller  → POST /calls/offer         → SSE call:incoming    → callee
 *   callee  → POST /calls/answer        → SSE call:answered    → caller
 *   either  → POST /calls/ice-candidate → SSE call:ice-candidate → peer
 *   either  → POST /calls/end           → SSE call:ended       → peer
 *   callee  → POST /calls/reject        → SSE call:rejected    → caller
 *
 * Media goes peer-to-peer (WebRTC); only signaling touches the server.
 * Voice-only by design — `call_type` is always `'audio'` and the codepaths
 * for video have been stripped to keep the surface simple and reliable.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../services/api';
import { ring, stopRing, playConnect, playDisconnect } from '../utils/callSounds';

// Public ICE servers.
//
// STUN-only works when at least one peer is on an open network (typical
// desktop-on-WiFi case). It FAILS when both peers are behind symmetric NAT
// — which is exactly what happens between two cellular phones, and was
// the reason calls "connected" on the UI but had zero audio when both
// sides were on mobile data. Adding TURN gives us a relay fallback for
// that case.
//
// OpenRelay (metered.ca) publishes free public TURN credentials —
// intentionally shared, ~100 GB/month per project. Three URLs so the
// client can fall back through transports:
//   - turn:…:80           — UDP on port 80 (works through most NATs)
//   - turn:…:443          — UDP on the TLS port (works through filters
//                           that only allow 80/443)
//   - turn:…:443?transport=tcp — TCP relay for symmetric NAT + UDP-blocking
//                                firewalls (corporate WiFi / hotel networks)
//
// If our usage outgrows the free tier or we need self-hosted relay, swap
// in a coturn instance on the VPS — the URLs/credentials are the only
// thing that changes here.
const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  {
    urls: 'turn:openrelay.metered.ca:80',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
  {
    urls: 'turn:openrelay.metered.ca:443',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
  {
    urls: 'turn:openrelay.metered.ca:443?transport=tcp',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
];

// How long to wait for the callee to answer before auto-cancelling (45 s).
const CALL_TIMEOUT_MS = 45_000;

// Mobile vibration pattern for incoming calls. Re-armed every cycle while ringing.
const VIBRATE_PATTERN = [600, 500, 600, 500, 600, 500];

export type CallStatus =
  | 'idle'
  | 'calling' // outbound: waiting for callee to pick up
  | 'ringing' // inbound: incoming call, waiting for local answer/reject
  | 'connected' // media flowing both ways
  | 'ended'; // call finished (for any reason)

/** Kept for SSE/DB compatibility — only `'audio'` is produced by the UI now. */
export type CallType = 'audio';

export interface IncomingCallInfo {
  call_id: string;
  call_type: CallType;
  sdp: string;
  caller: {
    id: string;
    full_name?: string | null;
    email: string;
    role?: string;
  };
}

export interface UseCallReturn {
  status: CallStatus;
  peer: { id: string; full_name?: string | null; email: string } | null;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  incomingCall: IncomingCallInfo | null;
  isMuted: boolean;
  /** Seconds since the call connected. 0 while ringing / calling. */
  callDuration: number;
  /** Formatted MM:SS (or H:MM:SS for long calls) string of callDuration. */
  callDurationLabel: string;
  /** Most recent media / permission error, or null. Read by CallContext to
   *  show a toast — set on permission denial / device-not-found etc., cleared
   *  the moment the next call attempt starts or succeeds. */
  lastError: string | null;
  /** Manual clear — call after surfacing the toast so a stale error doesn't
   *  re-show on the next render. */
  clearError: () => void;
  startCall: (peerId: string, peerName: string | null, peerEmail: string) => Promise<void>;
  acceptCall: () => Promise<void>;
  rejectCall: () => Promise<void>;
  endCall: () => Promise<void>;
  toggleMute: () => void;
  /** Wire this into useRealtime in the parent component. */
  realtimeHandlers: Record<string, (payload: unknown) => void>;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** True when the error is a mic permission / dismissed-prompt failure
 *  that the user can resolve by simply tapping Call again (the browser
 *  will re-prompt). False for hard failures like NotFoundError. */
function isPermissionRetryable(err: unknown): boolean {
  const e = err as { name?: string };
  return e?.name === 'NotAllowedError' || e?.name === 'PermissionDeniedError';
}

function mediaErrorMessage(err: unknown, permanentlyBlocked = false): string {
  const e = err as { name?: string; message?: string };
  switch (e?.name) {
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'No microphone found. Connect a mic and try again.';
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return permanentlyBlocked
        ? // Browser remembers a previous "Block" choice — tapping Call won't re-prompt
          // until the user changes the site setting manually.
          'Microphone is blocked for this site. Tap the lock icon next to the URL → Site settings → Microphone → Allow, then tap Call again.'
        : // First-time or dismissed prompt — tapping Call again will re-prompt.
          'Microphone access is needed. Tap Call again and choose Allow when prompted.';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'Microphone is in use by another app or browser tab. Close it and try again.';
    case 'SecurityError':
      return 'Calls need a secure (HTTPS) connection.';
    default:
      return e?.message ?? 'Could not access microphone.';
  }
}

/** Ask the Permissions API whether the mic has been *permanently* blocked.
 *  Returns false on browsers that don't expose Permissions for microphone
 *  (older Safari) — we fall back to a non-permanent message in that case. */
async function micPermanentlyBlocked(): Promise<boolean> {
  try {
    const perms = navigator.permissions as
      | { query?: (d: { name: string }) => Promise<{ state: string }> }
      | undefined;
    if (!perms?.query) return false;
    const result = await perms.query({ name: 'microphone' });
    return result.state === 'denied';
  } catch {
    return false;
  }
}

export function useCall(): UseCallReturn {
  const [status, setStatus] = useState<CallStatus>('idle');
  const [peer, setPeer] = useState<{ id: string; full_name?: string | null; email: string } | null>(
    null,
  );
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [incomingCall, setIncomingCall] = useState<IncomingCallInfo | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);

  const clearError = useCallback(() => setLastError(null), []);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const callIdRef = useRef<string | null>(null);
  const pendingCandidates = useRef<RTCIceCandidateInit[]>([]);
  const pendingOutgoingCandidates = useRef<RTCIceCandidateInit[]>([]);
  const callTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectedAtRef = useRef<number | null>(null);
  const vibrateTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Screen Wake Lock — held while the call is connected so the device
  // doesn't sleep mid-conversation (would suspend WebRTC + drop audio on
  // Android and Mac Safari). Released on call end OR when the tab loses
  // visibility, then re-acquired when visible again (per Wake Lock spec).
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const iceRestartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Tick the duration once a second while connected.
  useEffect(() => {
    if (status !== 'connected') return;
    if (!connectedAtRef.current) connectedAtRef.current = Date.now();
    const id = setInterval(() => {
      const startedAt = connectedAtRef.current;
      if (!startedAt) return;
      setCallDuration(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [status]);

  // Acquire / release the screen Wake Lock based on call status. The browser
  // automatically drops the lock when the tab is hidden, so wire
  // visibilitychange to re-acquire whenever the user comes back during an
  // active call.
  useEffect(() => {
    if (status !== 'connected') {
      releaseWakeLock();
      return;
    }
    void acquireWakeLock();
    function onVisible() {
      if (document.visibilityState === 'visible' && status === 'connected') {
        void acquireWakeLock();
      }
    }
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      releaseWakeLock();
    };
  }, [status]);

  // ----- Screen Wake Lock helpers -----------------------------------------
  // Wake Lock keeps the screen / device awake while the call is connected.
  // Without this, Android Chrome and iOS Safari will suspend the page after
  // ~30 s of inactivity, which kills the WebRTC connection and drops audio.
  // The browser auto-releases the lock when the tab loses visibility, so we
  // also wire visibilitychange to re-acquire it when the user comes back.
  async function acquireWakeLock(): Promise<void> {
    try {
      const wl = (
        navigator as { wakeLock?: { request: (t: 'screen') => Promise<WakeLockSentinel> } }
      ).wakeLock;
      if (!wl) return; // Unsupported (older Safari, embedded webviews)
      wakeLockRef.current = await wl.request('screen');
    } catch {
      /* user denied / browser blocked — not fatal, call still works */
    }
  }

  function releaseWakeLock(): void {
    const sentinel = wakeLockRef.current;
    wakeLockRef.current = null;
    if (!sentinel) return;
    try {
      void sentinel.release();
    } catch {
      /* ignore */
    }
  }

  function stopVibration() {
    // Only call navigator.vibrate(0) if we actually STARTED a vibration via
    // the timer. Calling it unconditionally on every cleanup (including the
    // unmount safety net) made Chrome log a console warning
    //   "Blocked call to navigator.vibrate because user hasn't tapped on
    //    the frame yet"
    // on every page load (CallProvider mounts → cleanup deps run → vibrate
    // fires without a gesture). Gated by the timer ref so the call only
    // happens during an actual in-progress ring.
    if (!vibrateTimerRef.current) return;
    clearInterval(vibrateTimerRef.current);
    vibrateTimerRef.current = null;
    try {
      navigator.vibrate?.(0);
    } catch {
      /* not supported */
    }
  }

  function startVibration() {
    if (typeof navigator === 'undefined' || !navigator.vibrate) return;
    try {
      navigator.vibrate(VIBRATE_PATTERN);
    } catch {
      return;
    }
    vibrateTimerRef.current = setInterval(() => {
      try {
        navigator.vibrate(VIBRATE_PATTERN);
      } catch {
        stopVibration();
      }
    }, 3_600);
  }

  // -------------------------------------------------------------------------
  // Cleanup — closes PC, releases media, stops sounds + vibration
  // -------------------------------------------------------------------------

  const cleanup = useCallback(() => {
    if (callTimeoutRef.current) {
      clearTimeout(callTimeoutRef.current);
      callTimeoutRef.current = null;
    }
    if (iceRestartTimerRef.current) {
      clearTimeout(iceRestartTimerRef.current);
      iceRestartTimerRef.current = null;
    }
    releaseWakeLock();
    stopRing();
    stopVibration();

    if (pcRef.current) {
      pcRef.current.onicecandidate = null;
      pcRef.current.ontrack = null;
      pcRef.current.close();
      pcRef.current = null;
    }
    setLocalStream((s) => {
      s?.getTracks().forEach((t) => t.stop());
      return null;
    });
    setRemoteStream(null);
    pendingCandidates.current = [];
    pendingOutgoingCandidates.current = [];
    callIdRef.current = null;
    connectedAtRef.current = null;
    setCallDuration(0);
  }, []);

  const finalise = useCallback(
    (next: CallStatus, playSound = true) => {
      cleanup();
      if (playSound && next === 'ended') playDisconnect();
      setStatus(next);
      setPeer(null);
      setIncomingCall(null);
      setIsMuted(false);
    },
    [cleanup],
  );

  // -------------------------------------------------------------------------
  // Build RTCPeerConnection + remote-stream wiring
  // -------------------------------------------------------------------------

  function buildPC(peerId: string): RTCPeerConnection {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    // ICE / connection state diagnostics. Without these, a call that fails
    // NAT traversal (the most common silent-call symptom on mobile
    // networks) looks identical to a working call in the UI — both sides
    // see "Connected" because we set that on SDP exchange, not on actual
    // RTP flow. Logging the state changes makes the failure mode
    // diagnosable from DevTools in the field. If the state lands in
    // 'failed', mark the call ended so the user gets clear feedback
    // instead of staring at a connected screen with no audio.
    pc.oniceconnectionstatechange = () => {
      console.info('[useCall] iceConnectionState:', pc.iceConnectionState);
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        // Stable connection — cancel any pending ICE-restart that was
        // queued during a transient 'disconnected' state.
        if (iceRestartTimerRef.current) {
          clearTimeout(iceRestartTimerRef.current);
          iceRestartTimerRef.current = null;
        }
        return;
      }
      if (pc.iceConnectionState === 'disconnected') {
        // Transient — usually the user switched WiFi ↔ cellular or hit a
        // brief network blip. Give it 4 s to recover on its own, then
        // force an ICE restart so the connection can re-negotiate
        // candidates against the new network. Without this, the call
        // stays "disconnected" forever after a network switch.
        if (iceRestartTimerRef.current) return;
        iceRestartTimerRef.current = setTimeout(() => {
          iceRestartTimerRef.current = null;
          if (pcRef.current !== pc) return; // call was already ended
          if (pc.iceConnectionState === 'disconnected') {
            console.info('[useCall] restarting ICE after disconnect');
            try {
              pc.restartIce();
            } catch {
              /* older browsers / Safari pre-13 don't support restartIce */
            }
          }
        }, 4_000);
        return;
      }
      if (pc.iceConnectionState === 'failed') {
        setLastError(
          "Couldn't connect through your network. Try switching to WiFi, or ask your network admin to allow WebRTC traffic.",
        );
        finalise('ended');
      }
    };
    pc.onconnectionstatechange = () => {
      console.info('[useCall] connectionState:', pc.connectionState);
    };

    pc.onicecandidate = ({ candidate }) => {
      if (!candidate) return;
      const payload = {
        candidate: candidate.candidate,
        sdpMid: candidate.sdpMid ?? null,
        sdpMLineIndex: candidate.sdpMLineIndex ?? null,
      };
      if (!callIdRef.current) {
        pendingOutgoingCandidates.current.push(payload);
        return;
      }
      api
        .post('/calls/ice-candidate', {
          call_id: callIdRef.current,
          peer_id: peerId,
          candidate: payload,
        })
        .catch(() => {});
    };

    // Bind the remote stream from ontrack DIRECTLY — don't pre-create an empty
    // stream and try to swap it. Some mobile browsers (notably iOS Safari) won't
    // switch the playing source if srcObject was set to an empty MediaStream
    // first, which causes the "connected but silent" symptom.
    pc.ontrack = ({ track, streams }) => {
      const stream = streams && streams[0] ? streams[0] : new MediaStream([track]);
      setRemoteStream(stream);
    };

    return pc;
  }

  async function drainPending(pc: RTCPeerConnection) {
    for (const c of pendingCandidates.current) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(c));
      } catch {
        // stale or invalid candidate — not fatal
      }
    }
    pendingCandidates.current = [];
  }

  function flushOutgoingCandidates(peerId: string, callId: string) {
    const queued = pendingOutgoingCandidates.current.splice(0);
    for (const candidate of queued) {
      api
        .post('/calls/ice-candidate', { call_id: callId, peer_id: peerId, candidate })
        .catch(() => {});
    }
  }

  async function getMicStream(): Promise<MediaStream> {
    // Guard for old / non-browser / insecure-context environments. getUserMedia
    // is undefined on http:// (non-localhost) and on browsers without WebRTC
    // (in-app webviews, very old Android stock browsers). Throwing a typed
    // error here lets mediaErrorMessage map it to the SecurityError copy.
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      const err = new Error(
        'Voice calls are not supported in this browser. Use a recent Chrome, Safari, Firefox or Edge over HTTPS.',
      ) as Error & { name?: string };
      err.name = 'SecurityError';
      throw err;
    }
    // Explicit audio constraints — request the three quality filters every
    // platform supports. Most browsers default these to true, but iOS
    // Safari and some Android Chromes need them explicit or they fall back
    // to raw mic input, which produces ear-piercing echo over speakerphone.
    return navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
  }

  // -------------------------------------------------------------------------
  // startCall — outbound (voice only)
  // -------------------------------------------------------------------------

  const startCall = useCallback(
    async (peerId: string, peerName: string | null, peerEmail: string) => {
      if (status !== 'idle') return;
      setLastError(null); // any stale "mic blocked" from a previous attempt
      setStatus('calling');
      setPeer({ id: peerId, full_name: peerName, email: peerEmail });

      // Ringback tone for the caller — stops once the callee answers.
      ring();

      // Auto-cancel if no answer within 45 s.
      callTimeoutRef.current = setTimeout(() => {
        const callId = callIdRef.current;
        finalise('ended');
        if (callId) {
          api.post('/calls/end', { call_id: callId, peer_id: peerId }).catch(() => {});
        }
      }, CALL_TIMEOUT_MS);

      try {
        const stream = await getMicStream();
        setLocalStream(stream);

        const pc = buildPC(peerId);
        pcRef.current = pc;
        // Use addTransceiver('audio', {direction:'sendrecv'}) and attach the
        // track to its sender — instead of bare addTrack(). Two reasons:
        //   1. Explicit sendrecv direction. On iOS Safari, bare addTrack
        //      occasionally yields a transceiver with direction "sendonly"
        //      or even "inactive" until the answer renegotiates. Pinning
        //      sendrecv up-front guarantees the offer has the right
        //      direction for the audio m-section.
        //   2. The callee can match this transceiver kind-for-kind during
        //      its own setRemoteDescription, avoiding the duplicate
        //      transceiver bug that caused the caller→callee audio drop.
        for (const track of stream.getAudioTracks()) {
          const tx = pc.addTransceiver('audio', { direction: 'sendrecv' });
          await tx.sender.replaceTrack(track);
        }

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        const res = await api.post('/calls/offer', {
          callee_id: peerId,
          call_type: 'audio',
          // Use pc.localDescription.sdp (browser-finalised) rather than
          // offer.sdp — some browsers tweak the SDP during
          // setLocalDescription (e.g. inline ICE candidates), and the
          // tweaked version is what the peer must see.
          sdp: pc.localDescription?.sdp ?? offer.sdp,
        });
        const callId = res.data.call_id as string;
        callIdRef.current = callId;
        flushOutgoingCandidates(peerId, callId);
      } catch (err: unknown) {
        const e = err as { response?: { data?: { error?: string } } };
        const serverMsg = e?.response?.data?.error;
        // Permission-denied: skip the "Call ended" banner + the 2.5 s idle
        // wait, so tapping Call again works immediately. Also detect the
        // permanently-blocked state so the toast can guide the user to
        // unblock at the browser settings level.
        if (isPermissionRetryable(err) && !serverMsg) {
          cleanup();
          setStatus('idle');
          setPeer(null);
          const blocked = await micPermanentlyBlocked();
          throw new Error(mediaErrorMessage(err, blocked));
        }
        finalise('ended', false);
        throw new Error(serverMsg ?? mediaErrorMessage(err));
      }
    },
    // buildPC is a plain function declared in the component body and
    // re-created every render — listing it in deps would regenerate
    // startCall on every render for no real benefit. The closures it
    // captures (setLastError, finalise, setRemoteStream) all have stable
    // identity from useState/useCallback, so the per-render churn is safe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [status, finalise, cleanup],
  );

  // -------------------------------------------------------------------------
  // acceptCall — inbound, callee side
  // -------------------------------------------------------------------------

  const acceptCall = useCallback(async () => {
    const incoming = incomingCall;
    if (!incoming) return;
    setIncomingCall(null);
    stopRing();
    stopVibration();

    const { call_id, sdp, caller } = incoming;
    setPeer({ id: caller.id, full_name: caller.full_name ?? null, email: caller.email });

    try {
      const stream = await getMicStream();
      setLocalStream(stream);

      const pc = buildPC(caller.id);
      pcRef.current = pc;
      callIdRef.current = call_id;

      // 1. setRemoteDescription FIRST so the offer's audio m-section
      //    instantiates an audio transceiver in the receiver direction.
      //    Doing addTrack BEFORE this was the root cause of the
      //    caller→callee silence: the callee ended up with TWO audio
      //    transceivers (one from addTrack, one from the offer), and on
      //    some browsers the answer's audio direction ended up as
      //    "recvonly" which dropped the caller's outbound audio packets.
      await pc.setRemoteDescription({ type: 'offer', sdp });

      // 2. Reuse the existing transceiver (from setRemoteDescription) for
      //    our send direction by replaceTrack on its sender. Pin the
      //    direction to sendrecv so the answer SDP keeps both directions
      //    open regardless of what the offer asked for.
      for (const track of stream.getAudioTracks()) {
        const audioTx =
          pc
            .getTransceivers()
            .find((tr) => tr.receiver.track.kind === 'audio' && !tr.sender.track) ?? null;
        if (audioTx) {
          await audioTx.sender.replaceTrack(track);
          audioTx.direction = 'sendrecv';
        } else {
          // No matching transceiver (unexpected — offer didn't have audio?).
          // Fall back to addTransceiver so we at least try to send our audio.
          const tx = pc.addTransceiver('audio', { direction: 'sendrecv' });
          await tx.sender.replaceTrack(track);
        }
      }

      // 3. Drain any ICE candidates that arrived before setRemoteDescription.
      await drainPending(pc);

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      await api.post('/calls/answer', {
        call_id,
        caller_id: caller.id,
        // Use pc.localDescription.sdp (browser-finalised) rather than
        // answer.sdp — same defence as on the caller side.
        sdp: pc.localDescription?.sdp ?? answer.sdp,
      });

      playConnect();
      setStatus('connected');
    } catch (err: unknown) {
      // Same UX as the outbound side: if the callee denied / dismissed
      // the mic prompt, snap straight back to "ringing" so they can tap
      // Accept again. Other failures (PC errors, etc.) fall through to
      // the standard "ended" banner.
      if (isPermissionRetryable(err)) {
        cleanup();
        setStatus('ringing');
        // Restore the incoming-call card so Accept is tappable again.
        setIncomingCall(incoming);
        ring();
        const blocked = await micPermanentlyBlocked();
        setLastError(mediaErrorMessage(err, blocked));
        return;
      }
      finalise('ended');
    }
    // Same reason as startCall: buildPC is a plain per-render function with
    // stable closures — listing it in deps just churns acceptCall identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingCall, finalise, cleanup]);

  const rejectCall = useCallback(async () => {
    const incoming = incomingCall;
    if (!incoming) return;
    setIncomingCall(null);
    stopRing();
    stopVibration();
    setStatus('idle');

    await api
      .post('/calls/reject', { call_id: incoming.call_id, caller_id: incoming.caller.id })
      .catch(() => {});
  }, [incomingCall]);

  const endCall = useCallback(async () => {
    const peerId = peer?.id;
    const callId = callIdRef.current;
    finalise('ended');
    if (peerId && callId) {
      await api.post('/calls/end', { call_id: callId, peer_id: peerId }).catch(() => {});
    }
  }, [peer, finalise]);

  const toggleMute = useCallback(() => {
    if (!localStream) return;
    localStream.getAudioTracks().forEach((t) => {
      t.enabled = !t.enabled;
    });
    setIsMuted((m) => !m);
  }, [localStream]);

  // -------------------------------------------------------------------------
  // SSE realtime handlers — wire into useRealtime in the parent component
  // -------------------------------------------------------------------------

  const realtimeHandlers: Record<string, (payload: unknown) => void> = {
    'call:incoming': (raw) => {
      const data = raw as IncomingCallInfo;
      if (!data?.call_id || !data?.caller?.id) return;

      if (status !== 'idle') {
        // Already in a call — auto-reject with busy.
        api
          .post('/calls/reject', { call_id: data.call_id, caller_id: data.caller.id })
          .catch(() => {});
        return;
      }
      setIncomingCall(data);
      setStatus('ringing');
      ring();
      startVibration();
    },

    'call:answered': async (raw) => {
      const { call_id, sdp } = raw as { call_id: string; sdp: string };
      if (call_id !== callIdRef.current) return;
      const pc = pcRef.current;
      if (!pc) return;
      try {
        await pc.setRemoteDescription({ type: 'answer', sdp });
        await drainPending(pc);
        stopRing();
        playConnect();
        setStatus('connected');
      } catch {
        finalise('ended');
      }
    },

    'call:ice-candidate': async (raw) => {
      const { call_id, candidate } = raw as { call_id: string; candidate: RTCIceCandidateInit };
      const activeCallId = callIdRef.current ?? incomingCall?.call_id ?? null;
      if (call_id !== activeCallId) return;
      const pc = pcRef.current;
      if (!pc || !pc.remoteDescription) {
        pendingCandidates.current.push(candidate);
        return;
      }
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch {
        // stale candidate
      }
    },

    'call:ended': () => {
      finalise('ended');
    },

    'call:rejected': () => {
      finalise('ended');
    },
  };

  // Reset status to idle after "ended" display delay.
  useEffect(() => {
    if (status === 'ended') {
      const t = setTimeout(() => setStatus('idle'), 2500);
      return () => clearTimeout(t);
    }
  }, [status]);

  // Unmount-safety net. If CallProvider is torn down mid-call (logout, route
  // wrapper unmounts, hot reload), close the PC + release mic + stop ringtone
  // and vibration. Without this, the mic LED stays on after sign-out and the
  // ringtone keeps playing for a few seconds.
  useEffect(() => {
    return () => {
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    status,
    peer,
    localStream,
    remoteStream,
    incomingCall,
    isMuted,
    callDuration,
    callDurationLabel: formatDuration(callDuration),
    lastError,
    clearError,
    startCall,
    acceptCall,
    rejectCall,
    endCall,
    toggleMute,
    realtimeHandlers,
  };
}
