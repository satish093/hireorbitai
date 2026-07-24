/**
 * URL safety — defence-in-depth for any value that reaches the OS as a link.
 *
 * Port of frontend/src/utils/safeUrl.ts, with a mobile-specific escalation in
 * the threat model.
 *
 * On the web, an unsafe href risks `javascript:` executing in the page. On a
 * phone, `Linking.openURL()` hands the string to the OPERATING SYSTEM, which
 * will happily resolve custom schemes into other apps. So a stored value like
 * `hireorbitai://…` or `tel:` or an arbitrary `myapp://` deep link is a
 * different and broader hazard than an inert anchor: it can drive another
 * installed app, or re-enter THIS app on a route the user never chose.
 *
 * The values in question are all user-supplied and stored: vendor websites,
 * consultant LinkedIn URLs, job `apply_url`, training resource links. The
 * backend validates some of these at write time (`safeContentUrl` in the
 * training controller), but rows can pre-date that hardening or arrive via a
 * manual SQL import — so the client must not trust stored data either.
 *
 * Policy: https only. Not http (credentials and documents travel over these),
 * not custom schemes, nothing else.
 */

import { Alert, Linking } from 'react-native';

export function isSafeHttpsUrl(raw: string | undefined | null): raw is string {
  if (!raw) return false;
  try {
    const u = new URL(raw);
    return u.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Open an external link, or refuse.
 *
 * Never call `Linking.openURL()` directly on stored data — go through this.
 * Returns true when the link was actually opened.
 */
export async function openExternalUrl(raw: string | undefined | null): Promise<boolean> {
  if (!isSafeHttpsUrl(raw)) {
    Alert.alert(
      'Link blocked',
      'That link isn’t a valid secure (https) address, so it wasn’t opened.',
    );
    return false;
  }
  try {
    const supported = await Linking.canOpenURL(raw);
    if (!supported) return false;
    await Linking.openURL(raw);
    return true;
  } catch {
    return false;
  }
}

/**
 * Host shown next to a link so the user can see where a tap leads before
 * taking it. Returns null for anything unsafe.
 */
export function displayHost(raw: string | undefined | null): string | null {
  if (!isSafeHttpsUrl(raw)) return null;
  try {
    return new URL(raw).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/**
 * Guard for values arriving on an INBOUND deep link.
 *
 * app.json registers `applinks:hireorbitai.com` and an Android autoVerify
 * filter, so the OS can hand this app arbitrary strings from an emailed or
 * pasted URL. A reset/invitation token is then forwarded to the backend, so it
 * must be shape-checked first rather than passed through blindly.
 *
 * The backend is the authority on whether a token is valid — this only rejects
 * inputs that cannot possibly be one.
 */
export function isPlausibleToken(raw: unknown): raw is string {
  return (
    typeof raw === 'string' && raw.length >= 16 && raw.length <= 512 && /^[\w.\-~+/=]+$/.test(raw)
  );
}
