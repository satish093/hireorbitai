/**
 * WebRTC call state machine.
 *
 * Signaling flows through the existing SSE channel:
 *   caller  → POST /calls/offer      → SSE call:incoming  → callee
 *   callee  → POST /calls/answer     → SSE call:answered  → caller
 *   either  → POST /calls/ice-candidate → SSE call:ice-candidate → peer
 *   either  → POST /calls/end        → SSE call:ended     → peer
 *   callee  → POST /calls/reject     → SSE call:rejected  → caller
 *
 * Media goes peer-to-peer (WebRTC); only signaling touches the server.
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

export type CallStatus =
  | 'idle'
  | 'calling' // outbound: waiting for callee to pick up
  | 'ringing' // inbound: incoming call, waiting for local answer/reject
  | 'connected' // media flowing both ways
  | 'ended'; // call finished (for any reason)

export type CallType = 'audio' | 'video';

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
  callType: CallType | null;
  peer: { id: string; full_name?: string | null; email: string } | null;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  incomingCall: IncomingCallInfo | null;
  isMuted: boolean;
  isCameraOff: boolean;
  startCall: (
    peerId: string,
    peerName: string | null,
    peerEmail: string,
    type: CallType,
  ) => Promise<void>;
  acceptCall: () => Promise<void>;
  rejectCall: () => Promise<void>;
  endCall: () => Promise<void>;
  toggleMute: () => void;
  toggleCamera: () => void;
  /** Wire this into useRealtime in the parent component. */
  realtimeHandlers: Record<string, (payload: unknown) => void>;
}

export function useCall(): UseCallReturn {
  const [status, setStatus] = useState<CallStatus>('idle');
  const [callType, setCallType] = useState<CallType | null>(null);
  const [peer, setPeer] = useState<{ id: string; full_name?: string | null; email: string } | null>(
    null,
  );
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [incomingCall, setIncomingCall] = useState<IncomingCallInfo | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const callIdRef = useRef<string | null>(null);
  const pendingCandidates = useRef<RTCIceCandidateInit[]>([]);
  const callTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // -------------------------------------------------------------------------
  // Cleanup — closes PC, releases media, stops sounds
  // -------------------------------------------------------------------------

  const cleanup = useCallback(() => {
    if (callTimeoutRef.current) {
      clearTimeout(callTimeoutRef.current);
      callTimeoutRef.current = null;
    }
    stopRing();

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
  }, []);

  const finalise = useCallback(
    (next: CallStatus, playSound = true) => {
      cleanup();
      if (playSound && next === 'ended') playDisconnect();
      setStatus(next);
      setCallType(null);
      setPeer(null);
      setIncomingCall(null);
      setIsMuted(false);
      setIsCameraOff(false);
    },
    [cleanup],
  );

  // -------------------------------------------------------------------------
  // Build RTCPeerConnection
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

    const stream = new MediaStream();
    setRemoteStream(stream);
    pc.ontrack = ({ track }) => {
      stream.addTrack(track);
    };

    return pc;
  }

  // -------------------------------------------------------------------------
  // Drain queued ICE candidates once remote description is set
  // -------------------------------------------------------------------------

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

  // -------------------------------------------------------------------------
  // Acquire local media
  // -------------------------------------------------------------------------

  async function getMedia(type: CallType): Promise<MediaStream> {
    return navigator.mediaDevices.getUserMedia({
      audio: true,
      video: type === 'video',
    });
  }

  // -------------------------------------------------------------------------
  // startCall — outbound
  // -------------------------------------------------------------------------

  const startCall = useCallback(
    async (peerId: string, peerName: string | null, peerEmail: string, type: CallType) => {
      if (status !== 'idle') return;
      setStatus('calling');
      setCallType(type);
      setPeer({ id: peerId, full_name: peerName, email: peerEmail });

      // Ring tone starts for the caller too — stops once the callee answers.
      ring();

      // Auto-cancel if no answer within 45 s.
      callTimeoutRef.current = setTimeout(() => {
        finalise('ended');
      }, CALL_TIMEOUT_MS);

      try {
        const stream = await getMedia(type);
        setLocalStream(stream);

        const pc = buildPC(peerId);
        pcRef.current = pc;
        stream.getTracks().forEach((t) => pc.addTrack(t, stream));

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        const res = await api.post('/calls/offer', {
          callee_id: peerId,
          call_type: type,
          sdp: offer.sdp,
        });
        callIdRef.current = res.data.call_id as string;
      } catch (err: unknown) {
        finalise('ended', false);
        const e = err as { response?: { data?: { error?: string } }; message?: string };
        throw new Error(e?.response?.data?.error ?? e?.message ?? 'Could not start call');
      }
    },
    [status, finalise],
  );

  // -------------------------------------------------------------------------
  // acceptCall — inbound, callee side
  // -------------------------------------------------------------------------

  const acceptCall = useCallback(async () => {
    // Atomically read and clear incomingCall to avoid race.
    const incoming = incomingCall;
    if (!incoming) return;
    setIncomingCall(null);
    stopRing();

    const { call_id, call_type, sdp, caller } = incoming;
    setStatus('connected');
    setCallType(call_type);
    setPeer({ id: caller.id, full_name: caller.full_name ?? null, email: caller.email });

    try {
      const stream = await getMedia(call_type);
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
    } catch {
      finalise('ended');
    }
  }, [incomingCall, finalise]);

  // -------------------------------------------------------------------------
  // rejectCall — inbound, callee declines
  // -------------------------------------------------------------------------

  const rejectCall = useCallback(async () => {
    const incoming = incomingCall;
    if (!incoming) return;
    setIncomingCall(null);
    stopRing();
    setStatus('idle');

    await api
      .post('/calls/reject', { call_id: incoming.call_id, caller_id: incoming.caller.id })
      .catch(() => {});
  }, [incomingCall]);

  // -------------------------------------------------------------------------
  // endCall — either side hangs up
  // -------------------------------------------------------------------------

  const endCall = useCallback(async () => {
    const peerId = peer?.id;
    const callId = callIdRef.current;
    finalise('ended');
    if (peerId && callId) {
      await api.post('/calls/end', { call_id: callId, peer_id: peerId }).catch(() => {});
    }
  }, [peer, finalise]);

  // -------------------------------------------------------------------------
  // Mute / camera toggle
  // -------------------------------------------------------------------------

  const toggleMute = useCallback(() => {
    if (!localStream) return;
    localStream.getAudioTracks().forEach((t) => {
      t.enabled = !t.enabled;
    });
    setIsMuted((m) => !m);
  }, [localStream]);

  const toggleCamera = useCallback(() => {
    if (!localStream) return;
    localStream.getVideoTracks().forEach((t) => {
      t.enabled = !t.enabled;
    });
    setIsCameraOff((off) => !off);
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
      ring(); // ring for callee
    },

    'call:answered': async (raw) => {
      const { call_id, sdp } = raw as { call_id: string; sdp: string };
      // Only apply if this matches the active outbound call.
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
    callType,
    peer,
    localStream,
    remoteStream,
    incomingCall,
    isMuted,
    isCameraOff,
    startCall,
    acceptCall,
    rejectCall,
    endCall,
    toggleMute,
    toggleCamera,
    realtimeHandlers,
  };
}
