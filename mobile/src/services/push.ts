/**
 * Hard push notifications — client side.
 *
 * Flow:
 *   1. After sign-in, ask for notification permission and fetch the Expo push
 *      token (getExpoPushTokenAsync), then POST it to /push/register.
 *   2. On sign-out, POST /push/unregister so a shared device stops receiving.
 *
 * IMPORTANT: the iOS Simulator has no APNs, so getExpoPushTokenAsync throws
 * there. That's expected and swallowed — registration is best-effort and must
 * never block sign-in. Delivery/handling is still testable on the simulator via
 * `xcrun simctl push`. On a real device (with the APNs key configured in EAS),
 * a real token is returned and the full path works.
 */
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { api } from './api';

let lastToken: string | null = null;

/** Foreground presentation: show the banner even while the app is open. */
export function configureNotificationHandler(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

/** Ask permission + register this device's token with the backend. Best-effort. */
export async function registerForPush(): Promise<void> {
  try {
    // On a simulator getExpoPushTokenAsync throws (no APNs) — the try/catch
    // below swallows it. Handlers stay wired so `simctl push` still works.
    const { status: existing } = await Notifications.getPermissionsAsync();
    let status = existing;
    if (status !== 'granted') {
      const req = await Notifications.requestPermissionsAsync();
      status = req.status;
    }
    if (status !== 'granted') return;

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Default',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? undefined;
    const { data: token } = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    if (!token) return;
    lastToken = token;
    await api.post('/push/register', {
      token,
      platform: Platform.OS === 'ios' ? 'ios' : 'android',
    });
  } catch {
    // No APNs (simulator), permission denied, or offline — all non-fatal.
  }
}

/** On sign-out: tell the backend to stop pushing to this device. */
export async function unregisterForPush(): Promise<void> {
  try {
    if (!lastToken) return;
    await api.post('/push/unregister', { token: lastToken });
    lastToken = null;
  } catch {
    // Non-fatal.
  }
}
