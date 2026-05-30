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

// ICE servers are now fetched per-call from the backend
// (GET /calls/turn-credentials). The backend stitches together Cloudflare
// Realtime TURN (primary, anycast global edge, 1,000 GB/month free) +
// Metered.ca free fallback + Google STUN. See
// backend/src/controllers/calls.controller.ts (turnCredentials handler)
// for the composition rules.
//
// Why per-call: Cloudflare-issued TURN credentials are short-lived (~1h,
// configurable via TURN_CREDENTIAL_TTL_SECONDS on the backend). Fetching
// once per call keeps the credentials fresh AND lets the backend rotate
// providers without a frontend redeploy.
//
// STUN-only is the absolute-fallback the hook uses when the backend
// endpoint is unreachable. Same-WiFi calls still work (STUN punches
// through symmetric NAT for local-net peers); cross-network calls will
// drop to ICE-failed and surface the existing "couldn't connect" error.
const STUN_ONLY_ICE: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

interface TurnCredentialsResponse {
  iceServers: RTCIceServer[];
  ttl_seconds?: number;
  providers?: { cloudflare?: boolean; metered?: boolean };
}

interface FetchedIce {
  iceServers: RTCIceServer[];
  /** Server-advertised credential lifetime in seconds, or null when not
   *  provided (STUN-only fallback). Drives the proactive refresh timer in
   *  buildPC so long-running calls don't end up with expired TURN creds. */
  ttlSeconds: number | null;
  /** 'fetched' when the backend returned a real iceServers list.
   *  'fallback' when we degraded to STUN-only because the request failed
   *  or returned an empty list.
   *
   *  Mid-call refresh paths (proactive + disconnect→restartIce) MUST skip
   *  pc.setConfiguration() when this is 'fallback'. Otherwise a transient
   *  /calls/turn-credentials failure rips the still-valid Cloudflare TURN
   *  servers off the live PC and leaves the call with NO relay path on
   *  the next WiFi↔cellular handoff — exactly the silent-failure mode the
   *  whole TURN-swap was meant to eliminate. Call-START paths still
   *  accept the fallback (no working config to lose at that point). */
  kind: 'fetched' | 'fallback';
}

/** Fetch a fresh iceServers list from the backend before opening a peer
 *  connection. Fail-soft: any network/parse error degrades to STUN-only so
 *  the call still attempts (just without the TURN relay fallback). The
 *  `kind` discriminator lets callers decide whether to apply the result
 *  to an already-running RTCPeerConnection.
 *
 *  `kind === 'fetched'` ONLY when the response includes at least one TURN
 *  provider entry. Both schemes count:
 *    - `turn:`  — TURN over UDP/TCP (RFC 7065)
 *    - `turns:` — TURN over TLS/TCP (RFC 7065). Common on corp / hotel
 *      networks that block UDP and only allow 443/tcp; Metered and
 *      Cloudflare both emit `turns:` URLs in that case.
 *  A response containing only STUN entries (no TURN provider configured
 *  on the backend) is treated as 'fallback' — a mid-call refresh that
 *  swapped TURN for STUN-only would strip the live PC's relay path the
 *  same way a fetch error would.
 *
 *  Exported for unit testing — the predicate is the core of the mid-call
 *  refresh safety contract. */
export function hasTurnServer(servers: RTCIceServer[]): boolean {
  return servers.some((s) => {
    const urls = Array.isArray(s.urls) ? s.urls : [s.urls];
    return urls.some((u) => typeof u === 'string' && /^turns?:/i.test(u));
  });
}

async function fetchIceServers(): Promise<FetchedIce> {
  try {
    const { data } = await api.get<TurnCredentialsResponse>('/calls/turn-credentials');
    if (
      data?.iceServers &&
      Array.isArray(data.iceServers) &&
      data.iceServers.length > 0 &&
      hasTurnServer(data.iceServers)
    ) {
      const ttl = typeof data.ttl_seconds === 'number' ? data.ttl_seconds : null;
      return { iceServers: data.iceServers, ttlSeconds: ttl, kind: 'fetched' };
    }
    // Backend response existed but had no TURN provider (only STUN, or
    // explicitly empty). Treat as fallback so mid-call refresh paths don't
    // strip the live PC's TURN servers.
    return { iceServers: STUN_ONLY_ICE, ttlSeconds: null, kind: 'fallback' };
  } catch (err) {
    console.warn('[useCall] turn-credentials fetch failed, falling back to STUN-only:', err);
    return { iceServers: STUN_ONLY_ICE, ttlSeconds: null, kind: 'fallback' };
  }
}

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

/** Why a call landed in the terminal `ended` state — drives the resolution card. */
export type CallEndReason = 'ended' | 'declined' | 'missed';

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
  /** True while the live connection is recovering (ICE disconnected → restart).
   *  Status stays `connected` and the timer keeps ticking; the UI shows a
   *  "Reconnecting…" / poor-network banner. */
  reconnecting: boolean;
  /** Why the last call ended — read while status === 'ended' to pick the
   *  resolution copy (ended / declined / missed). */
  endReason: CallEndReason | null;
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
  const [reconnecting, setReconnecting] = useState(false);
  const [endReason, setEndReason] = useState<CallEndReason | null>(null);

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
  // Serializes ALL TURN-credential mutations against the live PC — both
  // the proactive TTL-refresh path and the disconnect→restartIce path.
  // Either path that's mid-flight blocks the other from entering. Without
  // this cross-path serialization, the proactive refresh could fire
  // setConfiguration while the disconnect path is still fetching its own
  // fresh creds, leaving the final iceServers set determined by whichever
  // fetch resolves last (non-deterministic, fresher creds can be
  // clobbered by staler ones). Cleared in each path's finally + cleanup().
  const iceRestartInFlightRef = useRef(false);
  // Proactive TURN-credential refresh. Cloudflare-issued creds are TTL-bound
  // (default 1h); without a refresh, calls that survive past TTL would lose
  // their relay path when the next WiFi↔cellular handoff triggers an ICE
  // restart. The timer fires at ~85% of TTL, refetches, and pushes the new
  // iceServers into the live RTCPeerConnection via setConfiguration().
  const iceRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Bounded retry counter for the proactive refresh path. When the
  // /calls/turn-credentials endpoint is transiently down, we keep retrying
  // at a fixed 60 s cadence but cap attempts so a persistently-failing
  // backend can't pin us into a forever-retry loop. Reset to 0 on a
  // successful refresh.
  const iceRefreshFailuresRef = useRef(0);
  // Cap at ~10 minutes of 60 s retries before giving up; the call still
  // works with its current (possibly soon-stale) creds — we just stop
  // burning fetch attempts.
  const MAX_REFRESH_FAILURES = 10;

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
    if (iceRefreshTimerRef.current) {
      clearTimeout(iceRefreshTimerRef.current);
      iceRefreshTimerRef.current = null;
    }
    iceRestartInFlightRef.current = false;
    iceRefreshFailuresRef.current = 0;
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
    setReconnecting(false);
  }, []);

  const finalise = useCallback(
    (next: CallStatus, playSound = true, reason: CallEndReason = 'ended') => {
      cleanup();
      if (playSound && next === 'ended') playDisconnect();
      if (next === 'ended') setEndReason(reason);
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

  function buildPC(
    peerId: string,
    iceServers: RTCIceServer[],
    ttlSeconds: number | null,
  ): RTCPeerConnection {
    const pc = new RTCPeerConnection({ iceServers });

    // Proactive credential refresh. Cloudflare TURN creds are short-lived
    // (default 1h). Without this, a call that crosses the TTL boundary and
    // then triggers an ICE restart (the WiFi↔cellular handoff path below)
    // would relay with expired creds and land in 'failed'. Refresh at 85%
    // of TTL via setConfiguration() so the live RTCPeerConnection sees the
    // new servers without a renegotiation. Only schedule when TTL is sane
    // (>= 60s) so a misconfigured backend can't pin us into a tight loop.
    //
    // CRITICAL: only apply the new config when fetchIceServers returned
    // real backend data (kind === 'fetched'). A transient backend failure
    // returns the STUN-only fallback; calling setConfiguration with that
    // would rip the still-valid Cloudflare/Metered TURN servers off the
    // live PC, leaving the next WiFi↔cellular handoff with no relay path.
    // On fallback we instead retry sooner (60 s, bounded) so we recover
    // when the backend comes back.
    if (ttlSeconds && ttlSeconds >= 60) {
      const scheduleRefresh = (delaySec: number) => {
        if (iceRefreshTimerRef.current) clearTimeout(iceRefreshTimerRef.current);
        iceRefreshTimerRef.current = setTimeout(async function refresh() {
          iceRefreshTimerRef.current = null;
          if (pcRef.current !== pc) return; // call ended
          // Yield to a disconnect-driven restart that's already mid-flight.
          // Without this check, both paths could call setConfiguration in
          // rapid succession with potentially different iceServer sets,
          // leaving the final config determined by whichever fetch
          // resolved last. The disconnect path is the more urgent of the
          // two (the call is currently broken), so we cede and retry on
          // the fallback cadence — it will catch the next TTL window.
          if (iceRestartInFlightRef.current) {
            scheduleRefresh(60);
            return;
          }
          iceRestartInFlightRef.current = true;
          try {
            const fresh = await fetchIceServers();
            if (pcRef.current !== pc) return; // ended during the await
            if (fresh.kind === 'fetched') {
              iceRefreshFailuresRef.current = 0;
              try {
                pc.setConfiguration({ iceServers: fresh.iceServers });
              } catch {
                /* setConfiguration unsupported on very old Safari — no-op */
              }
              if (fresh.ttlSeconds && fresh.ttlSeconds >= 60) {
                scheduleRefresh(Math.floor(fresh.ttlSeconds * 0.85));
              }
              return;
            }
            // Fallback: backend was unreachable / returned empty. Do NOT
            // mutate the live PC. Retry at a fixed 60 s cadence until we
            // exhaust MAX_REFRESH_FAILURES, then give up so we don't burn
            // fetches forever against a dead backend.
            iceRefreshFailuresRef.current += 1;
            if (iceRefreshFailuresRef.current <= MAX_REFRESH_FAILURES) {
              scheduleRefresh(60);
            }
          } finally {
            // Same cross-call-race guard as the disconnect path: only
            // release the flag if we still own the PC. A stale call's
            // fetch resolving after a new call started must not clobber
            // the new call's serialization state.
            if (pcRef.current === pc) iceRestartInFlightRef.current = false;
          }
        }, delaySec * 1000);
      };
      scheduleRefresh(Math.floor(ttlSeconds * 0.85));
    }

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
        // Recovered — clear the "Reconnecting…" / poor-network banner.
        setReconnecting(false);
        return;
      }
      if (pc.iceConnectionState === 'disconnected') {
        // Surface the poor-network banner immediately. Status stays
        // 'connected' (timer keeps running) — the banner overlays it. The
        // 4 s ICE-restart recovery below either restores the connection
        // (→ setReconnecting(false) above) or the call eventually fails.
        setReconnecting(true);
        // Transient — usually the user switched WiFi ↔ cellular or hit a
        // brief network blip. Give it 4 s to recover on its own, then
        // force an ICE restart so the connection can re-negotiate
        // candidates against the new network. Without this, the call
        // stays "disconnected" forever after a network switch.
        // Re-entry guards: bail if a timer is queued OR a previous restart
        // is mid-flight (waiting on the credentials fetch). Without the
        // in-flight ref, a disconnected→connected→disconnected flap during
        // the async await would queue a second restart while the first is
        // still settling — two restartIce calls 3–4 s apart with racing
        // setConfiguration completion order.
        if (iceRestartTimerRef.current || iceRestartInFlightRef.current) return;
        iceRestartTimerRef.current = setTimeout(async () => {
          iceRestartTimerRef.current = null;
          if (pcRef.current !== pc) return; // call was already ended
          if (pc.iceConnectionState !== 'disconnected') return; // recovered on its own
          if (iceRestartInFlightRef.current) return; // belt + braces
          iceRestartInFlightRef.current = true;
          try {
            console.info('[useCall] restarting ICE after disconnect');
            // Refetch credentials before restart. Cloudflare TURN creds are
            // TTL-bound (~1h); a long call that survives past the TTL then
            // hits a WiFi↔cellular handoff would otherwise restart with
            // expired creds and land in 'failed'.
            //
            // CRITICAL: only apply the new config when the fetch returned
            // real backend data. A transient backend failure returns the
            // STUN-only fallback; applying it would rip the still-valid
            // Cloudflare TURN servers off the live PC and leave restartIce
            // gathering with no relay path — exactly the H1 failure mode
            // the credential refresh was meant to prevent.
            const fresh = await fetchIceServers();
            if (pcRef.current !== pc) return; // ended during the await
            if (fresh.kind === 'fetched') {
              // A successful disconnect-path fetch also re-arms the
              // proactive refresh path: if the proactive path had given
              // up after MAX_REFRESH_FAILURES of backend outage, this
              // tells us the backend is healthy again, so the next
              // proactive timer (driven by buildPC's original ttl) can
              // resume normal operation when it fires.
              iceRefreshFailuresRef.current = 0;
              try {
                pc.setConfiguration({ iceServers: fresh.iceServers });
              } catch {
                /* setConfiguration unsupported on very old Safari */
              }
            }
            try {
              pc.restartIce();
            } catch {
              /* older browsers / Safari pre-13 don't support restartIce */
            }
          } finally {
            // Only release the in-flight flag if we still own the live PC.
            // A stale call's fetch can resolve after the user has hung up
            // and dialed again; without this guard, the stale finally
            // would clobber the NEW call's in-flight flag and re-open the
            // double-restartIce race the flag was introduced to close.
            // cleanup() at end-call resets the flag on the same-call path.
            if (pcRef.current === pc) iceRestartInFlightRef.current = false;
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
      setEndReason(null); // clear a previous call's resolution
      setStatus('calling');
      setPeer({ id: peerId, full_name: peerName, email: peerEmail });

      // Ringback tone for the caller — stops once the callee answers.
      ring();

      // Auto-cancel if no answer within 45 s — caller side reads this as a
      // missed (unanswered) call in the resolution card + history.
      callTimeoutRef.current = setTimeout(() => {
        const callId = callIdRef.current;
        finalise('ended', true, 'missed');
        if (callId) {
          api.post('/calls/end', { call_id: callId, peer_id: peerId }).catch(() => {});
        }
      }, CALL_TIMEOUT_MS);

      try {
        // Fetch fresh ICE servers (Cloudflare + Metered + STUN) BEFORE
        // opening the peer connection so each call uses short-lived TURN
        // credentials and the freshest provider list. Failures fall back
        // to STUN-only inside fetchIceServers(). ttlSeconds is wired into
        // buildPC so the proactive refresh timer fires at ~85% of TTL.
        const [stream, ice] = await Promise.all([getMicStream(), fetchIceServers()]);
        setLocalStream(stream);

        const pc = buildPC(peerId, ice.iceServers, ice.ttlSeconds);
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
      // Same per-call ICE fetch as startCall — keeps the callee's TURN
      // credentials fresh and lets the backend rotate providers without
      // a frontend redeploy. ttlSeconds drives the proactive refresh.
      const [stream, ice] = await Promise.all([getMicStream(), fetchIceServers()]);
      setLocalStream(stream);

      const pc = buildPC(caller.id, ice.iceServers, ice.ttlSeconds);
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
      setEndReason(null); // clear a previous call's resolution
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
      // If the peer hung up while we were still ringing (never accepted),
      // that's a missed call for us; otherwise a normal end.
      finalise('ended', true, status === 'ringing' ? 'missed' : 'ended');
    },

    'call:rejected': () => {
      // Outbound side: the callee declined.
      finalise('ended', true, 'declined');
    },

    // Multi-tab clearance: when the callee answers (or rejects) on ANOTHER
    // tab/device, the backend publishes one of these to every SSE stream of
    // the callee. The active tab guards on call_id and ignores its own copy.
    // Without this, laptop + phone + stale tabs all keep ringing + vibrating
    // long after the call was answered elsewhere — the phone-in-meeting bug.
    'call:accepted-elsewhere': (raw) => {
      const { call_id } = raw as { call_id: string };
      if (status !== 'ringing' || incomingCall?.call_id !== call_id) return;
      setIncomingCall(null);
      stopRing();
      stopVibration();
      setStatus('idle');
    },

    'call:rejected-elsewhere': (raw) => {
      const { call_id } = raw as { call_id: string };
      if (status !== 'ringing' || incomingCall?.call_id !== call_id) return;
      setIncomingCall(null);
      stopRing();
      stopVibration();
      setStatus('idle');
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
    reconnecting,
    endReason,
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
