/**
 * CallModal — four states:
 *
 *  ringing   — Discord-style corner notification: caller name, Accept/Decline
 *  calling   — centered "Calling…" card + cancel
 *  connected — full modal: video feeds (or audio avatar) + in-call controls
 *  ended     — brief "Call ended" badge
 *
 * Portaled to document.body so fixed positioning is viewport-relative,
 * not relative to the transformed <main> element (see frontend-responsive rules).
 */

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { Avatar } from './TaskBits';
import { IconPhone, IconPhoneOff, IconVideo, IconMic, IconMicOff, IconCameraOff } from './Icons';
import type { CallStatus, CallType, UseCallReturn } from '../hooks/useCall';

interface CallModalProps {
  status: CallStatus;
  callType: CallType | null;
  peer: { id: string; full_name?: string | null; email: string } | null;
  incomingCall: UseCallReturn['incomingCall'];
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  isMuted: boolean;
  isCameraOff: boolean;
  onAccept: () => void;
  onReject: () => void;
  onEnd: () => void;
  onToggleMute: () => void;
  onToggleCamera: () => void;
}

export function CallModal({
  status,
  callType,
  peer,
  incomingCall,
  localStream,
  remoteStream,
  isMuted,
  isCameraOff,
  onAccept,
  onReject,
  onEnd,
  onToggleMute,
  onToggleCamera,
}: CallModalProps) {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = localStream ?? null;
    }
  }, [localStream]);

  useEffect(() => {
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteStream ?? null;
    }
  }, [remoteStream]);

  if (status === 'idle') return null;

  const callerInfo = incomingCall?.caller ?? peer;
  const displayName = callerInfo?.full_name ?? callerInfo?.email ?? 'Unknown';
  const isVideo = callType === 'video';

  return createPortal(
    <>
      {/* ------------------------------------------------------------------ */}
      {/* RINGING — Discord-style corner notification (bottom-right)          */}
      {/* ------------------------------------------------------------------ */}
      {status === 'ringing' && incomingCall && (
        <div className="fixed bottom-6 right-6 z-50 w-80 bg-surface border border-border rounded-2xl shadow-2xl p-4 animate-in slide-in-from-bottom-4 fade-in duration-300">
          {/* Pulsing ring indicator */}
          <div className="flex items-center gap-3 mb-4">
            <div className="relative shrink-0">
              <Avatar name={callerInfo?.full_name} email={callerInfo?.email ?? ''} size={44} />
              <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-green-500 border-2 border-surface animate-ping" />
              <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-green-500 border-2 border-surface" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink truncate">{displayName}</p>
              <p className="text-xs text-muted">
                Incoming {incomingCall.call_type === 'video' ? 'video' : 'voice'} call…
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={onReject}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400 hover:bg-rose-200 dark:hover:bg-rose-900/50 text-sm font-medium transition-colors"
            >
              <IconPhoneOff size={16} />
              Decline
            </button>
            <button
              onClick={onAccept}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-green-500 hover:bg-green-600 text-white text-sm font-medium transition-colors"
            >
              {incomingCall.call_type === 'video' ? (
                <IconVideo size={16} />
              ) : (
                <IconPhone size={16} />
              )}
              Answer
            </button>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* CALLING — centered card while waiting for callee                   */}
      {/* ------------------------------------------------------------------ */}
      {status === 'calling' && peer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
          <div className="bg-surface border border-border rounded-2xl shadow-2xl w-full max-w-sm p-6 flex flex-col items-center gap-5">
            <Avatar name={peer.full_name} email={peer.email} size={72} />
            <div className="text-center space-y-1">
              <p className="text-xs text-muted uppercase tracking-wider font-medium">
                {callType === 'video' ? 'Video calling…' : 'Calling…'}
              </p>
              <p className="text-xl font-semibold text-ink">{displayName}</p>
              <div className="flex justify-center gap-1 pt-1">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="w-2 h-2 rounded-full bg-brand-500 animate-bounce"
                    style={{ animationDelay: `${i * 150}ms` }}
                  />
                ))}
              </div>
            </div>
            <button
              onClick={onEnd}
              className="w-16 h-16 rounded-full bg-rose-600 hover:bg-rose-700 flex items-center justify-center text-white shadow-lg transition-colors"
              title="Cancel call"
            >
              <IconPhoneOff size={26} />
            </button>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* CONNECTED — in-call with video or audio UI                          */}
      {/* ------------------------------------------------------------------ */}
      {status === 'connected' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm p-4">
          <div
            className={clsx(
              'bg-slate-900 rounded-2xl shadow-2xl overflow-hidden flex flex-col',
              isVideo ? 'w-full max-w-3xl max-h-[calc(100dvh-2rem)]' : 'w-full max-w-sm',
            )}
          >
            {isVideo ? (
              <div className="relative flex-1 bg-slate-800 min-h-64">
                <video
                  ref={remoteVideoRef}
                  autoPlay
                  playsInline
                  className="w-full h-full object-cover"
                />
                {/* Local PiP */}
                <div className="absolute bottom-3 right-3 w-28 h-20 rounded-xl overflow-hidden border-2 border-white/20 shadow-lg bg-slate-700">
                  <video
                    ref={localVideoRef}
                    autoPlay
                    playsInline
                    muted
                    className={clsx('w-full h-full object-cover', isCameraOff && 'invisible')}
                  />
                  {isCameraOff && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <IconCameraOff size={20} className="text-white/50" />
                    </div>
                  )}
                </div>
                <div className="absolute top-3 left-3 px-2 py-1 rounded-lg bg-black/40 backdrop-blur-sm text-white text-sm font-medium">
                  {displayName}
                </div>
              </div>
            ) : (
              <div className="py-10 flex flex-col items-center gap-4 bg-slate-800">
                <Avatar name={peer?.full_name} email={peer?.email ?? ''} size={80} />
                <div className="text-center">
                  <p className="text-white font-semibold text-lg">{displayName}</p>
                  <p className="text-slate-400 text-sm">Connected</p>
                </div>
                {/* Hidden audio element for remote stream */}
                <video ref={remoteVideoRef} autoPlay playsInline className="hidden" />
              </div>
            )}

            {/* Controls */}
            <div className="flex items-center justify-center gap-4 py-4 px-4 bg-slate-900">
              <CallControl
                active={isMuted}
                activeIcon={<IconMicOff size={22} />}
                inactiveIcon={<IconMic size={22} />}
                label={isMuted ? 'Unmute' : 'Mute'}
                onClick={onToggleMute}
              />
              {isVideo && (
                <CallControl
                  active={isCameraOff}
                  activeIcon={<IconCameraOff size={22} />}
                  inactiveIcon={<IconVideo size={22} />}
                  label={isCameraOff ? 'Enable camera' : 'Disable camera'}
                  onClick={onToggleCamera}
                />
              )}
              <button
                onClick={onEnd}
                className="w-14 h-14 rounded-full bg-rose-600 hover:bg-rose-700 flex items-center justify-center text-white shadow-lg transition-colors"
                title="End call"
              >
                <IconPhoneOff size={24} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* ENDED — brief corner badge                                          */}
      {/* ------------------------------------------------------------------ */}
      {status === 'ended' && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 bg-surface border border-border rounded-full px-4 py-2 shadow-lg animate-in fade-in duration-200">
          <span className="text-base">📵</span>
          <span className="text-sm font-medium text-ink">Call ended</span>
        </div>
      )}
    </>,
    document.body,
  );
}

function CallControl({
  active,
  activeIcon,
  inactiveIcon,
  label,
  onClick,
}: {
  active: boolean;
  activeIcon: React.ReactNode;
  inactiveIcon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={clsx(
        'w-12 h-12 rounded-full flex items-center justify-center transition-colors',
        active
          ? 'bg-slate-600 text-white hover:bg-slate-500'
          : 'bg-slate-700 text-white/80 hover:bg-slate-600',
      )}
    >
      {active ? activeIcon : inactiveIcon}
    </button>
  );
}
