import toast from 'react-hot-toast';
import { useRealtime } from '../hooks/useRealtime';

/**
 * App-wide realtime notification surface. Renders nothing; it just keeps a
 * single SSE subscription open for the signed-in user and turns pushed
 * notification events into toasts.
 *
 * Today it handles `reminder:due` — emitted by the reminders dispatcher when
 * a reminder (including the auto-generated interview lead-time reminders)
 * fires. The email still goes out as before; this is the instant in-app
 * heads-up for a browser that happens to be open.
 *
 * Mounted once at the App level and keyed by user id, so it survives route
 * changes (no reconnect per navigation) and reconnects cleanly on login as a
 * different user.
 */
export function RealtimeNotifications() {
  useRealtime({
    'reminder:due': (payload) => {
      const p = (payload ?? {}) as { title?: string; description?: string };
      const title = p.title?.trim() || 'Reminder';
      toast(p.description ? `${title} — ${p.description}` : title, {
        icon: '🔔',
        duration: 6000,
      });
    },
  });
  return null;
}
