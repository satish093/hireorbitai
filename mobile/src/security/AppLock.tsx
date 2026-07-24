/**
 * App lock — biometric / device-credential gate over an already-authenticated
 * session.
 *
 * WHY THIS EXISTS, and what it is not:
 *
 * The web has no equivalent because a browser session dies with the tab and a
 * laptop is rarely handed to someone else unlocked. A phone is different: it
 * holds a 30-day refresh token, it gets lent to people, and it gets stolen
 * unlocked. This app shows immigration PII (H1B / EAD / I-20 / passport scans
 * via /work-auth-docs), invoices, and private DMs — none of which should be one
 * swipe away on a borrowed handset.
 *
 * This is a LOCAL possession check. It is not authentication and it grants
 * nothing: the JWT in SecureStore is the credential, the backend re-checks every
 * request, and a rooted device can bypass this entirely. Treat it as the
 * difference between "my phone was unlocked on a desk" and "someone read the
 * consultants' passport numbers".
 *
 * Behaviour:
 *   • opt-in per device, stored in AsyncStorage (a preference, not a secret)
 *   • locks on cold start and after LOCK_AFTER_MS in the background
 *   • falls back to the device passcode when biometrics fail or aren't enrolled
 *   • if no lock method exists at all, it degrades to unlocked rather than
 *     bricking the user out of their own app
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState, Text, View, type AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LocalAuthentication from 'expo-local-authentication';
import { useTheme } from '../theme';
import { Button } from '../components/ui/Button';
import { getSession } from '../services/session';

const ENABLED_KEY = 'hireorbitai.applock.enabled';

/**
 * Grace period. Re-prompting after a two-second app switch (to copy a code out
 * of an SMS, say) trains people to turn the feature off, which is strictly
 * worse than a short window.
 */
const LOCK_AFTER_MS = 60_000;

interface AppLockValue {
  enabled: boolean;
  locked: boolean;
  /** True when the device actually has biometrics or a passcode enrolled. */
  available: boolean;
  setEnabled: (on: boolean) => Promise<void>;
  unlock: () => Promise<boolean>;
}

const AppLockContext = createContext<AppLockValue | undefined>(undefined);

export function AppLockProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabledState] = useState(false);
  const [locked, setLocked] = useState(false);
  const [available, setAvailable] = useState(false);
  const backgroundedAt = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [saved, hasHardware, isEnrolled] = await Promise.all([
        AsyncStorage.getItem(ENABLED_KEY).catch(() => null),
        LocalAuthentication.hasHardwareAsync().catch(() => false),
        LocalAuthentication.isEnrolledAsync().catch(() => false),
      ]);
      if (cancelled) return;
      const canLock = !!hasHardware && !!isEnrolled;
      setAvailable(canLock);
      const on = saved === '1' && canLock;
      setEnabledState(on);
      // Cold start with the lock on and a session present → locked.
      setLocked(on && !!getSession());
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const unlock = useCallback(async (): Promise<boolean> => {
    try {
      const res = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock HireOrbit AI',
        // Allow the device passcode: biometrics fail on wet hands, masks, and
        // after a reboot. Without a fallback the user is simply locked out.
        disableDeviceFallback: false,
        cancelLabel: 'Cancel',
      });
      if (res.success) {
        setLocked(false);
        backgroundedAt.current = null;
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, []);

  const setEnabled = useCallback(
    async (on: boolean) => {
      // Turning it ON requires passing the check once — otherwise a user could
      // enable a lock they cannot satisfy and brick themselves out.
      if (on) {
        const ok = await unlock();
        if (!ok) return;
      }
      setEnabledState(on);
      setLocked(false);
      await AsyncStorage.setItem(ENABLED_KEY, on ? '1' : '0').catch(() => {});
    },
    [unlock],
  );

  useEffect(() => {
    const onChange = (state: AppStateStatus) => {
      if (!enabled) return;
      if (state === 'active') {
        const since = backgroundedAt.current;
        if (since !== null && Date.now() - since >= LOCK_AFTER_MS && getSession()) {
          setLocked(true);
        }
        backgroundedAt.current = null;
      } else if (state === 'background') {
        backgroundedAt.current = Date.now();
      }
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, [enabled]);

  // Signing out clears the lock — there is nothing left to protect, and a lock
  // screen over an empty session is a dead end.
  useEffect(() => {
    if (!getSession()) setLocked(false);
  }, [locked]);

  return (
    <AppLockContext.Provider value={{ enabled, locked, available, setEnabled, unlock }}>
      {children}
      {locked ? <LockOverlay onUnlock={unlock} /> : null}
    </AppLockContext.Provider>
  );
}

export function useAppLock(): AppLockValue {
  const ctx = useContext(AppLockContext);
  if (!ctx) throw new Error('useAppLock must be inside <AppLockProvider>');
  return ctx;
}

/**
 * Opaque cover rendered ABOVE the navigator rather than as a route.
 *
 * Deliberate: a route-based lock would unmount the screen underneath, losing
 * scroll position and in-progress form input every time someone checks a
 * notification. Covering keeps the app exactly where it was.
 */
function LockOverlay({ onUnlock }: { onUnlock: () => Promise<boolean> }) {
  const { colors, spacing, fontSize } = useTheme();
  const [failed, setFailed] = useState(false);

  // Prompt immediately — making the user tap "Unlock" before the OS sheet
  // appears is a pointless extra step.
  useEffect(() => {
    void (async () => {
      const ok = await onUnlock();
      if (!ok) setFailed(true);
    })();
  }, [onUnlock]);

  return (
    <View
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: colors.bg,
        alignItems: 'center',
        justifyContent: 'center',
        padding: spacing.xl,
      }}
    >
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: 32,
          backgroundColor: colors.accentSoft,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: spacing.lg,
        }}
      >
        <Text style={{ fontSize: 28 }}>🔒</Text>
      </View>
      <Text style={{ fontSize: fontSize.xl, fontWeight: '700', color: colors.ink }}>Locked</Text>
      <Text
        style={{
          fontSize: fontSize.base,
          color: colors.muted,
          textAlign: 'center',
          marginTop: spacing.sm,
          maxWidth: 320,
          lineHeight: 22,
        }}
      >
        {failed
          ? 'Authentication was cancelled. Unlock to get back to your workspace.'
          : 'Confirm it’s you to continue.'}
      </Text>
      <View style={{ marginTop: spacing['2xl'], width: '100%', maxWidth: 300 }}>
        <Button
          label="Unlock"
          onPress={() => {
            setFailed(false);
            void onUnlock().then((ok) => {
              if (!ok) setFailed(true);
            });
          }}
        />
      </View>
    </View>
  );
}
