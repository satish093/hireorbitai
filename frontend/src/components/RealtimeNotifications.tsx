import toast from 'react-hot-toast';
import { useLocation } from 'react-router-dom';
import { useRealtime } from '../hooks/useRealtime';
import { useAuth } from '../context/AuthContext';
import { invalidate } from '../hooks/useInvalidate';

/**
 * App-wide realtime notification surface. Renders nothing; it just keeps a
 * single SSE subscription open for the signed-in user and turns pushed
 * notification events into toasts.
 *
 * Handles:
 *   - `reminder:due`  — the reminders dispatcher fires (incl. interview lead-time
 *     reminders). The email still goes out; this is the instant in-app heads-up.
 *   - `message:new`   — a direct message arrived. Shows an unread alert toast
 *     (recipient only, suppressed while already viewing the inbox) and nudges
 *     the sidebar unread badge to refresh immediately.
 *
 * Mounted once at the App level and keyed by user id, so it survives route
 * changes (no reconnect per navigation) and reconnects cleanly on login as a
 * different user.
 */
export function RealtimeNotifications() {
  const { profile } = useAuth();
  const location = useLocation();

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
      // The backend fans out to BOTH ends; only alert the recipient, never echo
      // a message I just sent.
      if (!profile || m.sender_id === profile.id || m.recipient_id !== profile.id) return;
      // Refresh the sidebar unread badge right away (it otherwise polls on an
      // interval). Listeners on `messages` re-fetch their state.
      invalidate('messages');
      // Don't toast while the user is already reading their inbox.
      if (location.pathname.startsWith('/messages')) return;
      const who = m.sender?.full_name?.trim() || m.sender?.email || 'Someone';
      toast(`${who} sent you a message`, {
        icon: '✉️',
        duration: 6000,
      });
    },
  });
  return null;
}
