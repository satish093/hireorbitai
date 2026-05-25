import { useRealtime } from './useRealtime';
import { clearSession } from '../services/session';

/**
 * Listens for a `session:revoked` SSE event pushed by the backend when the
 * same account logs in on another device. On receipt, clears localStorage
 * and redirects to /login so the user is informed gracefully rather than
 * getting a cascade of 401 errors on the next API call.
 *
 * This hook should be mounted once at the root authenticated layout (App.tsx).
 * The underlying EventSource connection is established only when a session
 * exists (see useRealtime) and is torn down on sign-out / page navigation.
 */
export function useSessionRevoke(): void {
  useRealtime({
    'session:revoked': () => {
      clearSession();
      if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
        window.location.replace('/login');
      }
    },
  });
}
