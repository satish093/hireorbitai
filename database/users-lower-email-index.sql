-- ---------------------------------------------------------------------------
-- Functional index on lower(email) for case-insensitive login lookups.
--
-- The auth pipeline previously used `WHERE email ILIKE $1` which honoured
-- SQL `%` / `_` wildcards (both RFC-5321-legal in email local parts) and
-- let an unauthenticated attacker target the seeded SUPER_ADMIN by posting
-- `admin%@example.com`. That has been changed to `WHERE lower(email) =
-- lower($1)`. Without this index the new predicate is a full table scan
-- on every login attempt.
--
-- We also enforce case-insensitive uniqueness at the DB layer so two rows
-- like `Admin@x.com` and `admin@x.com` can never co-exist (the application
-- already lowercases on write, but the index belt-and-braces it).
--
-- Idempotent — safe to apply multiple times.
-- ---------------------------------------------------------------------------

create unique index if not exists users_lower_email_unique_idx
  on public.users (lower(email));
