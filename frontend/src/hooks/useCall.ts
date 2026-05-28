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

// Free public STUN servers — no account needed, no cost.
const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
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

function mediaErrorMessage(err: unknown): string {
  const e = err as { name?: string; message?: string };
  switch (e?.name) {
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'No microphone found. Connect a mic and try again.';
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return 'Microphone access was blocked. Allow it in the browser address bar and try again.';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'Microphone is in use by another app or browser tab. Close it and try again.';
    case 'SecurityError':
      return 'Calls need a secure (HTTPS) connection.';
    default:
      return e?.message ?? 'Could not access microphone.';
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

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const callIdRef = useRef<string | null>(null);
  const pendingCandidates = useRef<RTCIceCandidateInit[]>([]);
  const callTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectedAtRef = useRef<number | null>(null);
  const vibrateTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  function stopVibration() {
    if (vibrateTimerRef.current) {
      clearInterval(vibrateTimerRef.current);
      vibrateTimerRef.current = null;
    }
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

    pc.onicecandidate = ({ candidate }) => {
      if (!candidate || !callIdRef.current) return;
      api
        .post('/calls/ice-candidate', {
          call_id: callIdRef.current,
          peer_id: peerId,
          candidate: {
            candidate: candidate.candidate,
            sdpMid: candidate.sdpMid ?? null,
            sdpMLineIndex: candidate.sdpMLineIndex ?? null,
          },
        })
        .catch(() => {});
    };

    // Create the MediaStream up front and expose it via state. The CallModal
    // attaches it to an <audio autoplay> element. Tracks are added as they
    // arrive — modern browsers play newly-added audio tracks without re-binding.
    const stream = new MediaStream();
    setRemoteStream(stream);
    pc.ontrack = ({ track, streams }) => {
      // Prefer the stream the browser hands us (some Safari versions don't
      // hand-build incremental MediaStreams correctly).
      if (streams && streams[0]) {
        setRemoteStream(streams[0]);
      } else {
        stream.addTrack(track);
      }
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

  async function getMicStream(): Promise<MediaStream> {
    return navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  }

  // -------------------------------------------------------------------------
  // startCall — outbound (voice only)
  // -------------------------------------------------------------------------

  const startCall = useCallback(
    async (peerId: string, peerName: string | null, peerEmail: string) => {
      if (status !== 'idle') return;
      setStatus('calling');
      setPeer({ id: peerId, full_name: peerName, email: peerEmail });

      // Ringback tone for the caller — stops once the callee answers.
      ring();

      // Auto-cancel if no answer within 45 s.
      callTimeoutRef.current = setTimeout(() => {
        finalise('ended');
      }, CALL_TIMEOUT_MS);

      try {
        const stream = await getMicStream();
        setLocalStream(stream);

        const pc = buildPC(peerId);
        pcRef.current = pc;
        stream.getTracks().forEach((t) => pc.addTrack(t, stream));

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        const res = await api.post('/calls/offer', {
          callee_id: peerId,
          call_type: 'audio',
          sdp: offer.sdp,
        });
        callIdRef.current = res.data.call_id as string;
      } catch (err: unknown) {
        finalise('ended', false);
        const e = err as { response?: { data?: { error?: string } } };
        const serverMsg = e?.response?.data?.error;
        throw new Error(serverMsg ?? mediaErrorMessage(err));
      }
    },
    [status, finalise],
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

      stream.getTracks().forEach((t) => pc.addTrack(t, stream));

      await pc.setRemoteDescription({ type: 'offer', sdp });
      await drainPending(pc);

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      await api.post('/calls/answer', {
        call_id,
        caller_id: caller.id,
        sdp: answer.sdp,
      });

      playConnect();
      setStatus('connected');
    } catch {
      finalise('ended');
    }
  }, [incomingCall, finalise]);

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
      if (call_id !== callIdRef.current) return;
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

  return {
    status,
    peer,
    localStream,
    remoteStream,
    incomingCall,
    isMuted,
    callDuration,
    callDurationLabel: formatDuration(callDuration),
    startCall,
    acceptCall,
    rejectCall,
    endCall,
    toggleMute,
    realtimeHandlers,
  };
}
