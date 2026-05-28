-- Migration: add auth_sessions.refresh_lookup
--
-- Lets /auth/refresh resolve a token to its session row in O(1) using a
-- SHA-256 fingerprint of the raw refresh token, instead of bcrypt-comparing
-- up to 200 live sessions per request (CPU-DoS vector). bcrypt is still the
-- final verification — the lookup column only narrows the candidate set to 1.
--
-- SHA-256 leaks no useful info to an attacker who reads the DB: the raw token
-- has ~256 bits of entropy (48 random bytes from crypto.randomBytes), so
-- precomputing a rainbow table is computationally infeasible. The bcrypt hash
-- stays as before to keep the layered defence.
--
-- Pre-migration tokens have NULL refresh_lookup. The handler falls back to a
-- small bounded scan for those so existing logged-in users don't get kicked
-- out at deploy time. New tokens always populate the column.
--
-- Additive + idempotent.

ALTER TABLE public.auth_sessions
  ADD COLUMN IF NOT EXISTS refresh_lookup text;

CREATE INDEX IF NOT EXISTS auth_sessions_refresh_lookup_idx
  ON public.auth_sessions (refresh_lookup)
  WHERE refresh_lookup IS NOT NULL;
