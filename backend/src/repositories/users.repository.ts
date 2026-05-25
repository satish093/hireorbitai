/**
 * Users repository.
 *
 * Owns: public.users.
 * Used by: services/auth.service.ts, controllers/users.controller.ts,
 *          controllers/adminUsers.controller.ts, controllers/auth.controller.ts.
 *
 * This is one of three exemplar repositories — see ./README.md for the
 * pattern. The other 20+ controllers still call `db.from('users')` directly;
 * migrate them opportunistically when you touch a controller for other
 * reasons, not in a big-bang rewrite.
 */

import { db } from '../config/db';
import { httpError, Role } from '../types';

export type AccountStatus = 'active' | 'inactive' | 'suspended' | 'pending_verification' | 'banned';

export interface UserRow {
  id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  role: Role;
  avatar_url: string | null;
  is_active: boolean;
  status: AccountStatus | null;
  status_reason: string | null;
  must_change_password: boolean;
  temporary_password_sent_at: string | null;
  last_password_changed_at: string | null;
  failed_login_attempts: number;
  locked_until: string | null;
  last_login_at: string | null;
  session_version: number;
  group_id: string | null;
  created_at: string;
  updated_at: string;
}

/** Columns selected for "thin" user reads (auth middleware path). */
const THIN_COLS = 'id, email, role, group_id, must_change_password, status' as const;

/** Find by id; returns null if not found. */
export async function findById(id: string): Promise<UserRow | null> {
  const { data, error } = await db.from('users').select('*').eq('id', id).maybeSingle();
  if (error) throw httpError(500, 'Database error');
  return (data as UserRow | null) ?? null;
}

/** Find by id; throws 404 if not found. */
export async function requireById(id: string): Promise<UserRow> {
  const u = await findById(id);
  if (!u) throw httpError(404, 'User not found');
  return u;
}

/** Case-insensitive email lookup; returns null if not found. */
export async function findByEmail(email: string): Promise<UserRow | null> {
  const { data, error } = await db
    .from('users')
    .select('*')
    .ilike('email', email.trim())
    .maybeSingle();
  if (error) throw httpError(500, 'Database error');
  return (data as UserRow | null) ?? null;
}

/** Thin profile read used by the auth middleware on every request. */
export async function findThinForAuth(
  id: string,
): Promise<Pick<
  UserRow,
  'id' | 'email' | 'role' | 'group_id' | 'must_change_password' | 'status'
> | null> {
  const { data, error } = await db.from('users').select(THIN_COLS).eq('id', id).maybeSingle();
  if (error) throw httpError(500, 'Database error');
  return data as Pick<
    UserRow,
    'id' | 'email' | 'role' | 'group_id' | 'must_change_password' | 'status'
  > | null;
}

/** Reset failed-login counters + stamp `last_login_at`. */
export async function recordSuccessfulLogin(id: string): Promise<void> {
  const { error } = await db
    .from('users')
    .update({
      failed_login_attempts: 0,
      locked_until: null,
      last_login_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) throw httpError(500, 'Database error');
}

/** Bump `failed_login_attempts`; optionally arm `locked_until`. */
export async function recordFailedLogin(args: {
  id: string;
  attempts: number;
  lockUntil?: Date | null;
}): Promise<void> {
  const patch: Record<string, unknown> = { failed_login_attempts: args.attempts };
  if (args.lockUntil !== undefined) patch.locked_until = args.lockUntil?.toISOString() ?? null;
  const { error } = await db.from('users').update(patch).eq('id', args.id);
  if (error) throw httpError(500, 'Database error');
}

/** Clear must_change_password + stamp last_password_changed_at. */
export async function recordPasswordRotation(id: string): Promise<void> {
  const { error } = await db
    .from('users')
    .update({
      must_change_password: false,
      last_password_changed_at: new Date().toISOString(),
      failed_login_attempts: 0,
      locked_until: null,
    })
    .eq('id', id);
  if (error) throw httpError(500, 'Database error');
}

/**
 * Atomic status change. Bumps `session_version` when transitioning to a
 * non-active state so all of the user's access tokens are immediately
 * invalidated by middleware.
 */
export async function setStatus(args: {
  id: string;
  status: AccountStatus;
  reason: string | null;
  actorId: string;
}): Promise<UserRow> {
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    status: args.status,
    status_reason: args.status === 'active' ? null : args.reason,
    status_changed_at: now,
    status_changed_by: args.actorId,
    is_active: args.status === 'active',
    updated_at: now,
  };
  const { data, error } = await db
    .from('users')
    .update(patch)
    .eq('id', args.id)
    .select('*')
    .single();
  if (error) throw httpError(500, 'Database error');
  if (!data) throw httpError(404, 'User not found');

  // Bump session_version on a non-active transition — every existing access
  // token will fail middleware on its next use.
  if (args.status !== 'active') {
    await db.query('UPDATE public.users SET session_version = session_version + 1 WHERE id = $1', [
      args.id,
    ]);
  }

  return data as UserRow;
}
