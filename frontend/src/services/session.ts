/**
 * HireOrbit AI — frontend session store.
 *
 * Holds the backend-issued access + refresh token pair in localStorage.
 * Backend-issued tokens only. Pure functions — no React.
 *
 *  • access_token      short-lived JWT used as `Authorization: Bearer ...`
 *  • refresh_token     opaque, exchanged via POST /auth/refresh
 *  • expires_at        unix seconds; the api interceptor refreshes when
 *                      we're within REFRESH_SKEW_SEC of expiry
 */

const STORAGE_KEY = 'hireorbitai.session';
const REFRESH_SKEW_SEC = 60;

export interface StoredSession {
  access_token: string;
  refresh_token: string;
  expires_at: number; // unix seconds
  user: {
    id: string;
    email: string;
    full_name?: string | null;
    role?: string;
  } | null;
}

let memory: StoredSession | null = null;
let loaded = false;

function load(): StoredSession | null {
  if (loaded) return memory;
  loaded = true;
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    memory = JSON.parse(raw) as StoredSession;
    return memory;
  } catch {
    return null;
  }
}

export function getSession(): StoredSession | null {
  return load();
}

export function setSession(s: StoredSession | null): void {
  memory = s;
  loaded = true;
  if (typeof window === 'undefined') return;
  if (s) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  else window.localStorage.removeItem(STORAGE_KEY);
  // Notify listeners (AuthContext) so they don't have to poll.
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('hireorbitai:session-changed'));
  }
}

export function clearSession(): void {
  setSession(null);
}

export function isAccessTokenStale(s: StoredSession | null = getSession()): boolean {
  if (!s) return false;
  const now = Math.floor(Date.now() / 1000);
  return s.expires_at - now <= REFRESH_SKEW_SEC;
}

export function onSessionChange(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener('hireorbitai:session-changed', handler);
  // Cross-tab sync.
  const storageHandler = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) {
      loaded = false; // force reload from storage
      handler();
    }
  };
  window.addEventListener('storage', storageHandler);
  return () => {
    window.removeEventListener('hireorbitai:session-changed', handler);
    window.removeEventListener('storage', storageHandler);
  };
}
