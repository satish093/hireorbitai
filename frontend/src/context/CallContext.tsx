/**
 * Global call context.
 *
 * Wraps useCall() at the App level so the WebRTC state machine + CallModal
 * are alive regardless of which page the user is on. Incoming calls ring
 * and can be accepted/rejected from any route.
 *
 * Messages.tsx uses useCallContext() to trigger outbound calls.
 */

import { createContext, useContext, ReactNode } from 'react';
import { useCall, UseCallReturn } from '../hooks/useCall';
import { CallModal } from '../components/CallModal';

const CallContext = createContext<UseCallReturn | null>(null);

export function CallProvider({ children }: { children: ReactNode }) {
  const call = useCall();

  return (
    <CallContext.Provider value={call}>
      {children}
      <CallModal
        status={call.status}
        peer={call.peer}
        incomingCall={call.incomingCall}
        remoteStream={call.remoteStream}
        isMuted={call.isMuted}
        callDurationLabel={call.callDurationLabel}
        onAccept={call.acceptCall}
        onReject={call.rejectCall}
        onEnd={call.endCall}
        onToggleMute={call.toggleMute}
      />
    </CallContext.Provider>
  );
}

export function useCallContext(): UseCallReturn {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error('useCallContext must be used inside <CallProvider>');
  return ctx;
}
