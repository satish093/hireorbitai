import toast from 'react-hot-toast';
import { useLocation } from 'react-router-dom';
import { useRealtime } from '../hooks/useRealtime';
import { useAuth } from '../context/AuthContext';
import { useCallContext } from '../context/CallContext';
import { invalidate } from '../hooks/useInvalidate';
import { useInboxNotifications } from '../hooks/useInboxNotifications';

/**
 * App-wide realtime notification surface. Renders nothing; it just keeps a
 * single SSE subscription open for the signed-in user and turns pushed
 * notification events into toasts.
 *
 * Handles:
 *   - `reminder:due`  — the reminders dispatcher fires.
 *   - `message:new`   — direct message arrived; toast + badge nudge.
 *   - `call:*`        — WebRTC signaling events routed to the global CallContext.
 *
 * Mounted once at the App level and keyed by user id, so it survives route
 * changes (no reconnect per navigation) and reconnects cleanly on login.
 */
export function RealtimeNotifications() {
  const { profile } = useAuth();
  const location = useLocation();
  const call = useCallContext();

  useInboxNotifications();

  useRealtime({
    'reminder:due': (payload) => {
      const p = (payload ?? {}) as { title?: string; description?: string };
      const title = p.title?.trim() || 'Reminder';
      toast(p.description ? `${title} — ${p.description}` : title, {
        icon: '🔔',
        duration: 6000,
      });
    },

    'message:new': (payload) => {
      const m = (payload ?? {}) as {
        sender_id?: string;
        recipient_id?: string;
        sender?: { full_name?: string | null; email?: string | null } | null;
        body?: string | null;
      };
      if (!profile || m.sender_id === profile.id || m.recipient_id !== profile.id) return;
      invalidate('messages');
      if (location.pathname.startsWith('/messages')) return;
      const who = m.sender?.full_name?.trim() || m.sender?.email || 'Someone';
      toast(`${who} sent you a message`, { icon: '✉️', duration: 6000 });
    },

    // Call signaling — delegate to the global call state machine.
    // The CallModal (rendered by CallProvider) handles the full UI.
    // We additionally send a browser desktop notification when the tab is hidden.
    ...call.realtimeHandlers,

    // Wrap call:incoming to also fire a desktop notification when tab is hidden.
    'call:incoming': (payload) => {
      // First let the call state machine handle it (ring + modal).
      call.realtimeHandlers['call:incoming']?.(payload);

      // Desktop notification when tab not in focus.
      const data = payload as { caller?: { full_name?: string | null; email?: string } };
      const who = data?.caller?.full_name?.trim() || data?.caller?.email || 'Someone';
      if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
        const n = new Notification(`📞 ${who} is calling`, {
          body: 'Tap to open and accept or decline.',
          tag: 'incoming-call',
          requireInteraction: true,
        });
        n.onclick = () => {
          window.focus();
          n.close();
        };
      }
    },
  });

  return null;
}
