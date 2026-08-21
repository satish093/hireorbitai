import { Platform } from 'react-native';
import * as Application from 'expo-application';
import axios from 'axios';
import { config as appConfig } from '../config/env';

/**
 * Store-update gate — client half.
 *
 * Deliberately uses a BARE axios call rather than the shared `api` instance:
 *
 *   • no auth interceptor. The gate has to work while logged out, and a 401
 *     here must not fire onAuthFailure() and bounce the user to /login.
 *   • no 90s timeout. A gate that hangs for a minute and a half on a flaky
 *     network is worse than no gate — it delays the whole app boot.
 *   • no 429 cooldown coupling. This check must not poison, or be poisoned
 *     by, the cooldown map that the rest of the app shares.
 */

export interface VersionStatus {
  updateRequired: boolean;
  updateAvailable: boolean;
  latestVersion: string | null;
  storeUrl: string;
}

/** The running build's store version — "1.0.0" from app.json `version`. */
export function currentVersion(): string {
  return Application.nativeApplicationVersion ?? '';
}

const GATE_TIMEOUT_MS = 8_000;

/**
 * Fails OPEN on every error path. Offline, a 500, a timeout, a DNS failure —
 * none of those are evidence that the build is too old, and blocking on them
 * would make the app unusable exactly when the network is worst.
 */
export async function checkAppVersion(): Promise<VersionStatus | null> {
  const platform = Platform.OS === 'ios' ? 'ios' : 'android';
  const version = currentVersion();
  if (!version) return null;

  try {
    const res = await axios.get(`${appConfig.apiBaseUrl}/app-version`, {
      params: { platform, version },
      timeout: GATE_TIMEOUT_MS,
    });
    const d = res.data as Partial<VersionStatus>;
    return {
      updateRequired: !!d.updateRequired,
      updateAvailable: !!d.updateAvailable,
      latestVersion: d.latestVersion ?? null,
      storeUrl: d.storeUrl ?? '',
    };
  } catch {
    return null;
  }
}
