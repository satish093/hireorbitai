-- ---------------------------------------------------------------------------
-- Backfill: lowercase any existing mixed-case user emails.
--
-- The login lookup was changed from `email ILIKE $1` to a case-sensitive
-- `email = lower($1)` (ILIKE allowed wildcard-injection attacks against the
-- seeded admin). Any user row whose email was stored mixed-case — e.g. via the
-- admin.createUser path before it lowercased — would no longer match at login,
-- surfacing as "Invalid email or password" / "email not found".
--
-- This one-time backfill normalizes every email to lowercase so the lookup
-- matches. Idempotent — rows already lowercase are skipped by the WHERE clause.
--
-- The users_lower_email_unique_idx (from database/users-lower-email-index.sql)
-- guarantees no two rows collide once lowercased; if this UPDATE errors with a
-- unique violation it means two accounts differ only by case — resolve those
-- manually before re-running.
-- ---------------------------------------------------------------------------

UPDATE public.users
SET email = lower(email)
WHERE email <> lower(email);

NOTIFY pgrst, 'reload schema';
