/**
 * HireOrbit AI — backend-owned auth.
 *
 * Implements backend-owned auth: bcrypt password hashes stored in
 * public.users.password_hash and short-lived JWT access tokens signed with
 * env.jwt.secret. Refresh tokens are opaque random strings persisted in
 * public.auth_sessions, so global sign-out is a single UPDATE and access
 * tokens stay self-contained (no DB hit on every request).
 *
 * The exported `admin.*` and top-level methods deliberately match the subset
 * of the legacy third-party auth client the codebase used, so existing
 * callsites can be migrated by import swap instead of rewrite.
 */

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomBytes, randomUUID } from 'node:crypto';
import { pool } from './db';
import { env } from './env';

// ---------------------------------------------------------------------------
// Response shape (legacy client shape, preserved for callsite compatibility)
// ---------------------------------------------------------------------------
interface AuthErrorShape {
  message: string;
  status?: number;
  code?: string;
}
interface AuthResp<T> {
  data: T;
  error: AuthErrorShape | null;
}

export interface AuthUser {
  id: string;
  email: string;
  user_metadata?: Record<string, unknown>;
}
export interface Session {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  expires_in: number;
  token_type: 'bearer';
  user: AuthUser;
}

interface UserRow {
  id: string;
  email: string;
  password_hash: string | null;
  full_name: string | null;
  session_version: number;
}

// ---------------------------------------------------------------------------
// JWT helpers
// ---------------------------------------------------------------------------
interface JwtPayload {
  sub: string; // user id
  email: string;
  sv: number; // session_version at issue time
  iat: number;
  exp: number;
}

function signAccessToken(user: { id: string; email: string; session_version: number }): {
  token: string;
  expires_at: number;
} {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + env.jwt.accessTtlSeconds;
  const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
    sub: user.id,
    email: user.email,
    sv: user.session_version,
  };
  const token = jwt.sign(payload, env.jwt.secret, {
    algorithm: 'HS256',
    expiresIn: env.jwt.accessTtlSeconds,
  });
  return { token, expires_at: exp };
}

function verifyAccessToken(token: string): JwtPayload {
  return jwt.verify(token, env.jwt.secret, { algorithms: ['HS256'] }) as JwtPayload;
}

// ---------------------------------------------------------------------------
// Refresh-token persistence
//
// We keep refresh tokens as bcrypt hashes in public.auth_sessions so a DB
// leak doesn't hand the attacker a working refresh credential. The session
// row also records issued/used timestamps for audit visibility.
// ---------------------------------------------------------------------------
async function issueRefreshToken(userId: string): Promise<string> {
  const raw = randomBytes(48).toString('base64url');
  const hash = await bcrypt.hash(raw, 12);
  const expires = new Date(Date.now() + env.jwt.refreshTtlSeconds * 1000).toISOString();
  await pool.query(
    `INSERT INTO public.auth_sessions (id, user_id, refresh_hash, issued_at, expires_at)
     VALUES ($1, $2, $3, now(), $4)`,
    [randomUUID(), userId, hash, expires],
  );
  return raw;
}

async function revokeAllSessions(userId: string): Promise<void> {
  // Two-pronged revocation:
  //   1) bump session_version → every previously-issued access token is
  //      rejected on next request even before its TTL expires.
  //   2) delete refresh-token rows so refresh attempts fail.
  await pool.query(`UPDATE public.users SET session_version = session_version + 1 WHERE id = $1`, [
    userId,
  ]);
  await pool.query(`DELETE FROM public.auth_sessions WHERE user_id = $1`, [userId]);
}

// ---------------------------------------------------------------------------
// Public API — preserves the legacy call shapes for migration compatibility
// ---------------------------------------------------------------------------

/**
 * Verify a JWT and load the underlying user row. Used by `requireAuth`.
 * Returns { data: { user }, error } in the legacy client shape.
 */
export async function getUser(token: string): Promise<AuthResp<{ user: AuthUser | null }>> {
  try {
    const decoded = verifyAccessToken(token);
    const r = await pool.query<UserRow>(
      `SELECT id, email, full_name, session_version FROM public.users WHERE id = $1 LIMIT 1`,
      [decoded.sub],
    );
    const row = r.rows[0];
    if (!row) return { data: { user: null }, error: { message: 'User not found', status: 401 } };
    if (row.session_version !== decoded.sv) {
      return { data: { user: null }, error: { message: 'Session revoked', status: 401 } };
    }
    return {
      data: {
        user: { id: row.id, email: row.email, user_metadata: { full_name: row.full_name } },
      },
      error: null,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Invalid token';
    return { data: { user: null }, error: { message: msg, status: 401 } };
  }
}

/**
 * Email + password sign-in. Returns a session pair on success.
 * Used by services/auth.service.ts for password verification.
 */
export async function signInWithPassword(args: {
  email: string;
  password: string;
}): Promise<AuthResp<{ user: AuthUser | null; session: Session | null }>> {
  // Case-insensitive equality, not ILIKE. ILIKE would honour the SQL `%` and
  // `_` wildcards which RFC 5321 permits in the local-part of an email — an
  // attacker submitting `admin%@example.com` would otherwise match (and
  // brute-force / lock out via failed_login_attempts) the seeded SUPER_ADMIN
  // account. lower(email) keeps the case-insensitive intent without
  // wildcards. A functional index `(lower(email))` keeps the lookup O(log n).
  const r = await pool.query<UserRow>(
    `SELECT id, email, full_name, password_hash, session_version
       FROM public.users
       WHERE lower(email) = lower($1)
       LIMIT 1`,
    [args.email],
  );
  const row = r.rows[0];
  if (!row || !row.password_hash) {
    return {
      data: { user: null, session: null },
      error: { message: 'Invalid login credentials', status: 400 },
    };
  }
  const ok = await bcrypt.compare(args.password, row.password_hash);
  if (!ok) {
    return {
      data: { user: null, session: null },
      error: { message: 'Invalid login credentials', status: 400 },
    };
  }

  // Single-device enforcement: revoke every existing session before issuing a
  // new one. This bumps session_version so any in-flight JWTs become invalid
  // on the next requireAuth check, and deletes all refresh-token rows. We then
  // re-read session_version so the new access token carries the updated sv.
  await revokeAllSessions(row.id);
  const sv = await pool.query<{ session_version: number }>(
    `SELECT session_version FROM public.users WHERE id = $1 LIMIT 1`,
    [row.id],
  );
  row.session_version = sv.rows[0]!.session_version;

  return { data: await issueSession(row), error: null };
}

async function issueSession(row: UserRow): Promise<{ user: AuthUser; session: Session }> {
  const { token, expires_at } = signAccessToken(row);
  const refresh = await issueRefreshToken(row.id);
  const user: AuthUser = {
    id: row.id,
    email: row.email,
    user_metadata: { full_name: row.full_name },
  };
  return {
    user,
    session: {
      access_token: token,
      refresh_token: refresh,
      expires_at,
      expires_in: env.jwt.accessTtlSeconds,
      token_type: 'bearer',
      user,
    },
  };
}

/**
 * Exchange a refresh token for a new access/refresh pair. Rotates the
 * refresh token (old one is deleted before the new one is stored).
 */
export async function refreshSession(
  refreshToken: string,
): Promise<AuthResp<{ session: Session | null }>> {
  // Pull all live sessions for any user; bcrypt-compare is the only way to
  // find the matching row since the stored value is hashed. To keep this
  // cheap, scope the search by expires_at — expired rows are skipped.
  const r = await pool.query<{ id: string; user_id: string; refresh_hash: string }>(
    `SELECT id, user_id, refresh_hash FROM public.auth_sessions
       WHERE expires_at > now()
       ORDER BY issued_at DESC
       LIMIT 200`,
  );
  for (const sess of r.rows) {
    if (await bcrypt.compare(refreshToken, sess.refresh_hash)) {
      // Delete the old session row, then issue a fresh access + refresh pair.
      await pool.query(`DELETE FROM public.auth_sessions WHERE id = $1`, [sess.id]);
      const u = await pool.query<UserRow>(
        `SELECT id, email, full_name, password_hash, session_version FROM public.users WHERE id = $1`,
        [sess.user_id],
      );
      const row = u.rows[0];
      if (!row)
        return { data: { session: null }, error: { message: 'User not found', status: 401 } };
      const { session } = await issueSession(row);
      return { data: { session }, error: null };
    }
  }
  return { data: { session: null }, error: { message: 'Invalid refresh token', status: 401 } };
}

// ---------------------------------------------------------------------------
// admin.* surface
// ---------------------------------------------------------------------------

export const admin = {
  async createUser(args: {
    email: string;
    password: string;
    email_confirm?: boolean;
    user_metadata?: Record<string, unknown>;
  }): Promise<AuthResp<{ user: AuthUser | null }>> {
    const hash = await bcrypt.hash(args.password, 12);
    const id = randomUUID();
    // Normalize email to lowercase before storing. The login lookup
    // (loadUserByEmail) compares against a lowercased input via `.eq`, so a
    // mixed-case stored email would never match → "email not found" on
    // sign-in. Every other create path already lowercases; this one was the
    // gap.
    const email = args.email.trim().toLowerCase();
    // Insert into the canonical public.users row. The temp-password admin
    // flow in services/auth.service.ts upserts the same row with role +
    // metadata immediately after this call.
    try {
      await pool.query(
        `INSERT INTO public.users (id, email, password_hash, full_name, created_at, updated_at, session_version)
         VALUES ($1, $2, $3, $4, now(), now(), 0)
         ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
        [id, email, hash, (args.user_metadata?.full_name as string) ?? null],
      );
      // Re-read the row to capture the actual id (handles the ON CONFLICT path).
      const r = await pool.query<{ id: string; email: string; full_name: string | null }>(
        `SELECT id, email, full_name FROM public.users WHERE email = $1`,
        [email],
      );
      const row = r.rows[0]!;
      return {
        data: {
          user: { id: row.id, email: row.email, user_metadata: { full_name: row.full_name } },
        },
        error: null,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'createUser failed';
      return { data: { user: null }, error: { message: msg, status: 400 } };
    }
  },

  async deleteUser(userId: string): Promise<AuthResp<unknown>> {
    try {
      await pool.query(`DELETE FROM public.users WHERE id = $1`, [userId]);
      return { data: {}, error: null };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'deleteUser failed';
      return { data: {}, error: { message: msg, status: 500 } };
    }
  },

  async updateUserById(
    userId: string,
    args: { password?: string; email?: string; user_metadata?: Record<string, unknown> },
  ): Promise<AuthResp<{ user: AuthUser | null }>> {
    try {
      if (args.password) {
        const hash = await bcrypt.hash(args.password, 12);
        await pool.query(
          `UPDATE public.users SET password_hash = $1, last_password_changed_at = now(), updated_at = now() WHERE id = $2`,
          [hash, userId],
        );
      }
      if (args.email) {
        await pool.query(`UPDATE public.users SET email = $1, updated_at = now() WHERE id = $2`, [
          args.email,
          userId,
        ]);
      }
      const r = await pool.query<{ id: string; email: string; full_name: string | null }>(
        `SELECT id, email, full_name FROM public.users WHERE id = $1`,
        [userId],
      );
      const row = r.rows[0];
      if (!row) return { data: { user: null }, error: { message: 'User not found', status: 404 } };
      return {
        data: {
          user: { id: row.id, email: row.email, user_metadata: { full_name: row.full_name } },
        },
        error: null,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'updateUserById failed';
      return { data: { user: null }, error: { message: msg, status: 500 } };
    }
  },

  async signOut(userId: string, _scope: 'global' | 'local' = 'global'): Promise<AuthResp<unknown>> {
    try {
      await revokeAllSessions(userId);
      return { data: {}, error: null };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'signOut failed';
      return { data: {}, error: { message: msg, status: 500 } };
    }
  },

  /**
   * Mint a fresh session for an arbitrary user WITHOUT a password — used only
   * by the admin impersonation flow, which is rank-gated + audited upstream.
   * Issues a real access + refresh pair so the impersonated browser behaves
   * exactly like a normal login (and is revoked by the target's next global
   * sign-out / status change).
   */
  async createSessionForUser(userId: string): Promise<AuthResp<{ session: Session | null }>> {
    try {
      const r = await pool.query<UserRow>(
        `SELECT id, email, full_name, password_hash, session_version
           FROM public.users WHERE id = $1 LIMIT 1`,
        [userId],
      );
      const row = r.rows[0];
      if (!row)
        return { data: { session: null }, error: { message: 'User not found', status: 404 } };
      const { session } = await issueSession(row);
      return { data: { session }, error: null };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'createSessionForUser failed';
      return { data: { session: null }, error: { message: msg, status: 500 } };
    }
  },

  /** Used in one place (jobIngestion). Returns just enough to satisfy callers. */
  async listUsers(): Promise<AuthResp<{ users: AuthUser[] }>> {
    const r = await pool.query<{ id: string; email: string; full_name: string | null }>(
      `SELECT id, email, full_name FROM public.users ORDER BY created_at DESC LIMIT 1000`,
    );
    return {
      data: {
        users: r.rows.map((row) => ({
          id: row.id,
          email: row.email,
          user_metadata: { full_name: row.full_name },
        })),
      },
      error: null,
    };
  },
};
