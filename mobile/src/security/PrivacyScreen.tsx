/**
 * App-switcher privacy cover + screenshot control.
 *
 * Two distinct mobile leaks the web has no analogue for:
 *
 * 1. THE APP-SWITCHER SNAPSHOT.
 *    Both iOS and Android photograph the live screen when an app backgrounds,
 *    and show that image in the task switcher. If the user was reading a
 *    consultant's passport scan or an invoice, that frame sits in the switcher
 *    for anyone who picks up the phone — and on Android it is written to disk.
 *    <PrivacyCover> paints over the UI on `inactive`/`background`, so the
 *    captured frame is a blank branded panel.
 *
 * 2. SCREENSHOTS AND SCREEN RECORDING.
 *    useScreenCaptureGuard() blocks capture on the screens that show immigration
 *    PII (H1B / EAD / I-20 / passport via /work-auth-docs) and financial data.
 *
 * Scope, honestly: neither stops a camera pointed at the screen, and neither is
 * a substitute for the server-side authorization that actually protects this
 * data. They close the "someone glanced at the phone" and "the screenshot ended
 * up in a camera roll backup" holes, which are the realistic ones.
 *
 * On Android, `preventScreenCaptureAsync` sets FLAG_SECURE and genuinely blocks
 * capture. On iOS it cannot block the screenshot itself — the OS gives no such
 * API — it only detects it. So on iOS, treat this as detection, not prevention.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { AppState, Platform, StyleSheet, Text, View, type AppStateStatus } from 'react-native';
import { useFocusEffect } from 'expo-router';
import * as ScreenCapture from 'expo-screen-capture';
import { useTheme } from '../theme';

export function PrivacyCover({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  const [obscured, setObscured] = useState(false);

  useEffect(() => {
    const onChange = (state: AppStateStatus) => {
      // iOS fires `inactive` BEFORE `background` and takes its snapshot during
      // that window — covering only on `background` is too late.
      setObscured(state !== 'active');
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, []);

  return (
    <View style={{ flex: 1 }}>
      {children}
      {obscured ? (
        <View
          style={[
            StyleSheet.absoluteFill,
            {
              backgroundColor: colors.bg,
              alignItems: 'center',
              justifyContent: 'center',
            },
          ]}
          pointerEvents="none"
        >
          <Text style={{ fontSize: 20, fontWeight: '700', color: colors.ink }}>HireOrbit AI</Text>
        </View>
      ) : null}
    </View>
  );
}

/**
 * Block (Android) or detect (iOS) screen capture for as long as the calling
 * screen is mounted. Use on any screen rendering immigration documents,
 * invoices, resumes, or private message threads.
 *
 *   function WorkAuthDocsScreen() {
 *     useScreenCaptureGuard();
 *     …
 *   }
 */
export function useScreenCaptureGuard(active = true): void {
  // MUST be tied to FOCUS, not mount. Expo Router's <Tabs> keeps screens mounted
  // after you navigate away, so a mount/unmount effect would set FLAG_SECURE on
  // entering the chat/invoices and NEVER release it — leaving the whole app
  // unable to screenshot / screen-record / cast until a restart. useFocusEffect
  // applies the guard when the screen is focused and releases it on blur.
  useFocusEffect(
    useCallback(() => {
      if (!active) return;
      void ScreenCapture.preventScreenCaptureAsync('hireorbitai-sensitive').catch(() => {
        // Unsupported on some devices/emulators. Failing to harden must never
        // crash the screen the user came to read.
      });
      return () => {
        void ScreenCapture.allowScreenCaptureAsync('hireorbitai-sensitive').catch(() => {});
      };
    }, [active]),
  );
}

/**
 * iOS-only: fires when the user takes a screenshot of a sensitive screen.
 *
 * iOS gives no way to PREVENT the capture, so the honest options are to detect
 * and record. Wire the callback to an audit event if the product wants a trail
 * of who screenshotted a passport scan; the AuditAction union in
 * backend/src/services/audit.service.ts is closed, so a new verb has to be
 * added there first.
 */
export function useScreenshotDetection(onCapture: () => void, active = true): void {
  useEffect(() => {
    if (!active || Platform.OS !== 'ios') return;
    const sub = ScreenCapture.addScreenshotListener(() => onCapture());
    return () => sub.remove();
  }, [active, onCapture]);
}
