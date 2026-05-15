/**
 * Auth-sessions repository.
 *
 * Owns: public.auth_sessions (refresh-token rows).
 * Used by: config/auth.local.ts (signIn / refreshSession / revokeAllSessions).
 *
 * Storage shape: bcrypt-hashed refresh tokens. The raw refresh token is
 * never persisted; we compare candidates with `bcrypt.compare()` at refresh
 * time. Expired rows are scanned per attempt — fine at single-VPS scale; if
 * we ever exceed ~1k live sessions per user, swap to a per-user index of
 * `(user_id, last_4_chars)` to narrow the candidate set.
 */

import { randomUUID } from 'node:crypto';
import { pool } from '../config/db';
import { httpError } from '../types';

export interface AuthSessionRow {
  id: string;
  user_id: string;
  refresh_hash: string;
  issued_at: string;
  expires_at: string;
  user_agent: string | null;
  ip_address: string | null;
}

/** Insert a freshly-issued session (refresh_hash must already be bcrypted). */
export async function insert(args: {
  userId: string;
  refreshHash: string;
  expiresAt: Date;
  userAgent?: string | null;
  ipAddress?: string | null;
}): Promise<string> {
  const id = randomUUID();
  try {
    await pool.query(
      `INSERT INTO public.auth_sessions (id, user_id, refresh_hash, issued_at, expires_at, user_agent, ip_address)
       VALUES ($1, $2, $3, now(), $4, $5, $6)`,
      [
        id,
        args.userId,
        args.refreshHash,
        args.expiresAt.toISOString(),
        args.userAgent ?? null,
        args.ipAddress ?? null,
      ],
    );
    return id;
  } catch (err) {
    throw httpError(500, err instanceof Error ? err.message : 'insert auth_sessions failed');
  }
}

/**
 * Pull recent live sessions for the refresh-token bcrypt-compare scan.
 * Ordered newest-first, expired rows excluded.
 */
export async function listLiveCandidates(limit = 200): Promise<AuthSessionRow[]> {
  const r = await pool.query<AuthSessionRow>(
    `SELECT id, user_id, refresh_hash, issued_at, expires_at, user_agent, ip_address
       FROM public.auth_sessions
      WHERE expires_at > now()
      ORDER BY issued_at DESC
      LIMIT $1`,
    [limit],
  );
  return r.rows;
}

/** Delete a single session row by id (used during refresh-rotation). */
export async function deleteById(id: string): Promise<void> {
  await pool.query(`DELETE FROM public.auth_sessions WHERE id = $1`, [id]);
}

/** Delete every refresh-token row for a user (global sign-out). */
export async function deleteAllForUser(userId: string): Promise<void> {
  await pool.query(`DELETE FROM public.auth_sessions WHERE user_id = $1`, [userId]);
}

/** Sweep expired rows. Safe to call from a cron / startup hook. */
export async function purgeExpired(): Promise<number> {
  const r = await pool.query(`DELETE FROM public.auth_sessions WHERE expires_at <= now()`);
  return r.rowCount ?? 0;
}
