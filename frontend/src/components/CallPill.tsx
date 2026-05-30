/**
 * CallPill — the minimized live-call affordance.
 *
 * When the user minimizes the full-screen CallModal, the call keeps running
 * (useCall is independent of the modal) and this floating pill appears so the
 * call is reachable from any route. Click the body to re-expand the modal;
 * the red button hangs up.
 *
 * Mounted at the app root (CallProvider) alongside CallModal so it survives
 * navigation. Portaled to <body> so it's viewport-relative.
 *
 * Sits above the mobile bottom-nav (z-30) but below the full modal (z-50).
 */

import { createPortal } from 'react-dom';
import { Avatar } from './TaskBits';
import { IconPhoneOff } from './Icons';

interface CallPillProps {
  peer: { id: string; full_name?: string | null; email: string } | null;
  callDurationLabel: string;
  reconnecting: boolean;
  onExpand: () => void;
  onEnd: () => void;
}

export function CallPill({
  peer,
  callDurationLabel,
  reconnecting,
  onExpand,
  onEnd,
}: CallPillProps) {
  const name = peer?.full_name ?? peer?.email ?? 'In call';

  return createPortal(
    <div
      className="fixed right-4 z-40 animate-in fade-in slide-in-from-bottom-2 duration-200"
      style={{
        // Clear the mobile bottom-nav (58px + safe area) on small screens;
        // a comfortable 24px on desktop. max() keeps it above the gesture bar.
        bottom: 'max(calc(72px + env(safe-area-inset-bottom)), 24px)',
      }}
    >
      <div
        className="flex items-center gap-2.5 rounded-full py-1.5 pl-1.5 pr-2"
        style={{
          background: 'var(--bg-elev)',
          border: '1px solid var(--border)',
          boxShadow: 'var(--shadow-pop)',
        }}
      >
        {/* Expand — click avatar/name to reopen the full call screen */}
        <button
          type="button"
          onClick={onExpand}
          aria-label={`Return to call with ${name}`}
          className="flex items-center gap-2.5 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-accent pr-1"
        >
          <Avatar name={peer?.full_name} email={peer?.email ?? ''} size={34} />
          <div className="text-left leading-tight">
            <div
              className="text-[13px] font-semibold max-w-[140px] truncate"
              style={{ color: 'var(--ink)' }}
            >
              {name}
            </div>
            <div
              className="text-[11px] font-mono tabular-nums flex items-center gap-1"
              style={{ color: reconnecting ? 'var(--warn)' : 'var(--success)' }}
            >
              {/* Status conveyed by text, not color alone */}
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: reconnecting ? 'var(--warn)' : 'var(--success)' }}
                aria-hidden="true"
              />
              {reconnecting ? 'Reconnecting…' : callDurationLabel}
            </div>
          </div>
        </button>

        {/* End call */}
        <button
          type="button"
          onClick={onEnd}
          aria-label="End call"
          className="w-9 h-9 rounded-full grid place-items-center text-white shrink-0 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-300"
          style={{ background: 'var(--danger)' }}
        >
          <IconPhoneOff size={17} />
        </button>
      </div>
    </div>,
    document.body,
  );
}
