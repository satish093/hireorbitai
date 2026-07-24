/**
 * Idle sign-out.
 *
 * A browser tab gets closed; a phone app stays signed in for the 30-day life of
 * the refresh token. On a shared or company-issued handset that is a long time
 * for a session holding immigration PII and financial records to sit warm.
 *
 * After IDLE_LIMIT_MS with no foreground activity, the session is revoked
 * server-side (POST /auth/logout bumps users.session_version, killing every
 * refresh token) and the local copy is cleared.
 *
 * Deliberately conservative:
 *   • only foreground time counts. Background time is already covered by
 *     AppLock's biometric gate, and counting it would sign people out overnight
 *     for no security gain.
 *   • the timer resets on any recorded interaction, so an active user is never
 *     interrupted.
 *   • OFF by default. It is a policy control an admin-ish user opts into per
 *     device, not a surprise.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const ENABLED_KEY = 'hireorbitai.idletimeout.minutes';

/** Selectable windows, in minutes. 0 = off. */
export const IDLE_OPTIONS = [0, 15, 30, 60, 240] as const;
export type IdleMinutes = (typeof IDLE_OPTIONS)[number];

export function useIdleTimeout(onTimeout: () => void) {
  const [minutes, setMinutesState] = useState<IdleMinutes>(0);
  const lastActivity = useRef(Date.now());
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const onTimeoutRef = useRef(onTimeout);
  onTimeoutRef.current = onTimeout;

  useEffect(() => {
    void (async () => {
      const saved = await AsyncStorage.getItem(ENABLED_KEY).catch(() => null);
      const n = Number(saved);
      if (IDLE_OPTIONS.includes(n as IdleMinutes)) setMinutesState(n as IdleMinutes);
    })();
  }, []);

  const setMinutes = useCallback(async (n: IdleMinutes) => {
    setMinutesState(n);
    lastActivity.current = Date.now();
    await AsyncStorage.setItem(ENABLED_KEY, String(n)).catch(() => {});
  }, []);

  /** Call from a global touch handler to mark the user as active. */
  const touch = useCallback(() => {
    lastActivity.current = Date.now();
  }, []);

  useEffect(() => {
    if (timer.current) clearInterval(timer.current);
    if (minutes <= 0) return;

    const limitMs = minutes * 60_000;
    // A 30s poll is precise enough for a 15-minute floor and costs nothing.
    timer.current = setInterval(() => {
      if (AppState.currentState !== 'active') return;
      if (Date.now() - lastActivity.current >= limitMs) {
        lastActivity.current = Date.now();
        onTimeoutRef.current();
      }
    }, 30_000);

    return () => {
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
    };
  }, [minutes]);

  // Returning to the foreground counts as activity — the user is demonstrably
  // present, and background time is AppLock's job.
  useEffect(() => {
    const onChange = (s: AppStateStatus) => {
      if (s === 'active') lastActivity.current = Date.now();
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, []);

  return { minutes, setMinutes, touch };
}
