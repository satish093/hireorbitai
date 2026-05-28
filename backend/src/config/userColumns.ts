/**
 * Explicit allow-lists for SELECTing rows from `public.users`. Replaces
 * `select('*')` everywhere the result is serialised back to a client — `*`
 * implicitly leaks any new sensitive column added by a later migration
 * (password_hash, session_version, refresh-token/reset-token fields,
 * lockout counters, admin-only audit fields, …) the moment they land.
 *
 * Always-forbidden columns (never returned to ANY caller via these handlers):
 *
 *   password_hash       — bcrypt secret material.
 *   session_version     — bumped on global sign-out / password change; an
 *                          attacker who learns it can forge "still valid"
 *                          JWT claims.
 *   reset_token_hash    — reset-flow secret (if/when this column exists).
 *   refresh_*           — refresh credentials live on auth_sessions, but
 *                          stay paranoid in case anything bleeds into users.
 *   failed_login_attempts, locked_until, lockout_*  — auth-internal counters
 *                          we don't surface; revealing them helps a brute-force
 *                          attacker time around the lock.
 */

/**
 * Columns safe to return from /auth/me and /auth/sync (the caller's OWN row).
 * Everything here is information the signed-in user already has or needs
 * to render their UI.
 *
 * Defined as a single comma-joined string so it can be passed straight to the
 * PostgREST-style db.from(...).select(...) call.
 */
export const SAFE_USER_SELF_COLUMNS = [
  'id',
  'email',
  'full_name',
  'phone',
  'role',
  'avatar_url',
  'is_active',
  'must_change_password',
  'group_id',
  'capabilities',
  'tour_completed_at',
  'job_alerts',
  'last_login_at',
  'last_seen_at',
  'created_at',
  'updated_at',
].join(', ');

/**
 * Columns safe to return from /admin/users/:id (admin viewing another user).
 * Adds the admin-only operational fields (status / reason / notes / reports_to)
 * that the admin detail page reads, but still NEVER reveals password_hash,
 * session_version, or any lockout/refresh internal.
 */
export const SAFE_USER_ADMIN_DETAIL_COLUMNS = [
  // Same set as SAFE_USER_SELF_COLUMNS:
  'id',
  'email',
  'full_name',
  'phone',
  'role',
  'avatar_url',
  'is_active',
  'must_change_password',
  'group_id',
  'capabilities',
  'tour_completed_at',
  'job_alerts',
  'last_login_at',
  'last_seen_at',
  'created_at',
  'updated_at',
  // Admin-only operational fields:
  'status',
  'status_reason',
  'status_changed_at',
  'status_changed_by',
  'reports_to',
  // Real DB column is admin_notes (see database/admin-user-management.sql).
  // The legacy "notes" column belongs to recruiters/consultants — selecting
  // it here would either return NULL or fail with a column-not-found error
  // on hosts whose users table doesn't have a stray `notes` column.
  'admin_notes',
].join(', ');
