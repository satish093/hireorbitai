/**
 * HireOrbit AI — mobile session store.
 *
 * Same contract as frontend/src/services/session.ts (getSession / setSession /
 * clearSession / isAccessTokenStale / onSessionChange) so every downstream
 * consumer — the api client, AuthContext, the realtime hook — is written the
 * same way on both clients.
 *
 * ONE deliberate difference from web: the backing store.
 *
 *   web    → window.localStorage       (synchronous)
 *   mobile → expo-secure-store         (async; Keychain on iOS, Keystore on Android)
 *
 * localStorage on a phone would mean plaintext tokens in a file that any
 * jailbreak/root — or an unencrypted device backup — can read. The refresh
 * token is a 30-day credential, so it belongs in the OS secure enclave.
 *
 * SecureStore's async API is bridged to the web's synchronous one by hydrating
 * ONCE at boot into an in-memory copy:
 *
 *   1. hydrateSession()  — awaited in app/_layout.tsx before anything renders
 *   2. getSession()      — synchronous read of the hydrated copy
 *   3. setSession()      — updates memory + notifies listeners synchronously,
 *                          then persists in the background
 *
 * Writes are fire-and-forget on purpose: blocking a sign-in on a Keychain
 * write would add visible latency, and the in-memory copy is already correct.
 * A write failure only costs the user a re-login on next cold start.
 */

import * as SecureStore from 'expo-secure-store';

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
let hydrated = false;

type Listener = () => void;
const listeners = new Set<Listener>();

function notify(): void {
  for (const l of [...listeners]) {
    try {
      l();
    } catch {
      /* a throwing listener must not break the others */
    }
  }
}

/**
 * Load the persisted session into memory. Call exactly once, awaited, before
 * the first render — `app/_layout.tsx` does this behind the splash screen.
 * Idempotent: repeat calls resolve immediately.
 */
export async function hydrateSession(): Promise<StoredSession | null> {
  if (hydrated) return memory;
  try {
    const raw = await SecureStore.getItemAsync(STORAGE_KEY);
    memory = raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    // Corrupt payload or a Keychain read failure (e.g. device locked during a
    // background launch). Treat as signed-out rather than crashing the app.
    memory = null;
  } finally {
    hydrated = true;
  }
  return memory;
}

/** True once hydrateSession() has resolved. Guards against a pre-boot read. */
export function isSessionHydrated(): boolean {
  return hydrated;
}

/** Synchronous read of the hydrated session. Null when signed out. */
export function getSession(): StoredSession | null {
  return memory;
}

/**
 * Write the session. Memory + listeners update synchronously; the encrypted
 * write happens in the background.
 */
export function setSession(s: StoredSession | null): void {
  memory = s;
  hydrated = true;
  notify();
  void persist(s);
}

async function persist(s: StoredSession | null): Promise<void> {
  try {
    if (s) {
      await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(s), {
        // Readable after first unlock so a background push-triggered refresh
        // works, but never migrated to a new device via iCloud backup.
        keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
      });
    } else {
      await SecureStore.deleteItemAsync(STORAGE_KEY);
    }
  } catch {
    /* in-memory copy is authoritative for this launch */
  }
}

export function clearSession(): void {
  setSession(null);
}

/** True when the access token is within REFRESH_SKEW_SEC of expiring. */
export function isAccessTokenStale(s: StoredSession | null = getSession()): boolean {
  if (!s) return false;
  const now = Math.floor(Date.now() / 1000);
  return s.expires_at - now <= REFRESH_SKEW_SEC;
}

/**
 * True when the access token has ALREADY expired.
 *
 * Web has no equivalent because a browser tab refreshes on a timer while it is
 * open. A phone app gets suspended: it can return to the foreground hours later
 * holding a long-dead token. The api client uses this to force a refresh on
 * resume rather than firing a request it knows will 401.
 */
export function isAccessTokenExpired(s: StoredSession | null = getSession()): boolean {
  if (!s) return false;
  return s.expires_at <= Math.floor(Date.now() / 1000);
}

/** Subscribe to session changes (sign-in / sign-out / token rotation). */
export function onSessionChange(handler: Listener): () => void {
  listeners.add(handler);
  return () => {
    listeners.delete(handler);
  };
}
