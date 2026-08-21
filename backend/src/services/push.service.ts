/**
 * Hard (remote) push notifications via the Expo Push API.
 *
 * The mobile app is Expo-managed, so device tokens are Expo push tokens
 * (ExponentPushToken[...]). Expo relays to APNs (iOS) / FCM (Android), so this
 * one HTTP call covers both platforms and needs no APNs/FCM keys on the server
 * — Expo holds those. (For a bare-workflow app you'd swap this for node-apn +
 * firebase-admin; the register/dispatch shape here stays the same.)
 *
 * Delivery is best-effort and NEVER throws into a caller: a push failure must
 * not break the reminder dispatcher or a message send. Dead tokens reported by
 * Expo (DeviceNotRegistered) are revoked so we stop paying to send to them.
 */
import { db } from '../config/db';
import { logger } from '../config/logger';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

export interface PushMessage {
  title: string;
  body: string;
  /** Deep-link routing payload the app reads on tap (e.g. {type:'reminder', id}). */
  data?: Record<string, unknown>;
  /** iOS badge count; omit to leave unchanged. */
  badge?: number;
}

interface TokenRow {
  token: string;
}

/** Save (or re-point) a device token for a user. Upsert on the token. */
export async function registerToken(
  userId: string,
  token: string,
  platform: 'ios' | 'android',
): Promise<void> {
  // A token is globally unique; on a shared device a new login must steal it
  // from the previous user, so conflict re-points user_id and clears revoke.
  await db.from('device_push_tokens').upsert(
    {
      user_id: userId,
      token,
      platform,
      last_seen_at: new Date().toISOString(),
      revoked_at: null,
    },
    { onConflict: 'token' },
  );
}

/** Revoke a token (logout on this device, or provider said it's dead). */
export async function revokeToken(token: string): Promise<void> {
  await db
    .from('device_push_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('token', token);
}

/**
 * Send a push to every live device a user has. Best-effort; swallows all
 * errors. Returns the number of tokens it attempted.
 */
export async function sendPushToUser(userId: string, msg: PushMessage): Promise<number> {
  let tokens: string[] = [];
  try {
    const { data } = await db
      .from('device_push_tokens')
      .select('token')
      .eq('user_id', userId)
      .is('revoked_at', null);
    tokens = ((data as TokenRow[]) ?? []).map((r) => r.token);
  } catch (err) {
    logger.warn({ err, userId }, 'push: token lookup failed');
    return 0;
  }
  if (tokens.length === 0) return 0;

  const messages = tokens.map((to) => ({
    to,
    title: msg.title,
    body: msg.body,
    data: msg.data ?? {},
    sound: 'default',
    ...(msg.badge != null ? { badge: msg.badge } : {}),
  }));

  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(messages),
    });
    const json = (await res.json().catch(() => null)) as {
      data?: Array<{ status: string; details?: { error?: string } }>;
    } | null;

    // Revoke tokens Expo reports as permanently unregistered.
    const tickets = json?.data ?? [];
    tickets.forEach((t, i) => {
      if (t.status === 'error' && t.details?.error === 'DeviceNotRegistered') {
        void revokeToken(tokens[i]);
      }
    });
  } catch (err) {
    logger.warn({ err, userId, count: tokens.length }, 'push: send failed');
  }
  return tokens.length;
}
