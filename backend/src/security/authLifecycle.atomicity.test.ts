/**
 * Static regression tests for security-sensitive SQL shapes that race
 * conditions and replay attacks depend on.
 *
 * Each assertion is on the SOURCE TEXT of a single controller/service file
 * (not runtime behaviour). The goal is to pin the exact SQL shape so a
 * later refactor can't silently swap an atomic CAS for a read+write or
 * drop a defensive UPDATE.
 *
 * Audit drivers behind each pin:
 *  - assertNotLastSuperAdmin: previously a separate SELECT + count → vulnerable
 *    to TOCTOU when two concurrent deactivations targeted the org's last
 *    SUPER_ADMIN. Fix is `SELECT … FOR UPDATE` on the candidate row.
 *  - setUserStatus: previously did not invalidate outstanding
 *    password_reset_tokens, letting a reset link issued before deactivation
 *    be replayed after a later reactivation.
 *  - invitations.setup / acceptInvitation: previously read status=PENDING
 *    then later UPDATE'd to ACCEPTED, letting two concurrent accept clicks
 *    fire createUser/wireHierarchy twice. Fix is atomic UPDATE …
 *    WHERE status='PENDING' RETURNING id.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ADMIN_USERS = readFileSync(
  join(__dirname, '..', 'controllers', 'adminUsers.controller.ts'),
  'utf-8',
);
const AUTH_SERVICE = readFileSync(join(__dirname, '..', 'services', 'auth.service.ts'), 'utf-8');
const INVITATIONS_CTRL = readFileSync(
  join(__dirname, '..', 'controllers', 'invitations.controller.ts'),
  'utf-8',
);
const INVITATIONS_SVC = readFileSync(
  join(__dirname, '..', 'services', 'invitation.service.ts'),
  'utf-8',
);

describe('assertNotLastSuperAdmin — atomic last-admin guard', () => {
  it('locks the candidate user row with FOR UPDATE to serialize concurrent deactivations', () => {
    expect(ADMIN_USERS).toMatch(/FROM\s+public\.users\s+WHERE\s+id\s*=\s*\$1\s+FOR UPDATE/i);
  });

  it('counts OTHER active super-admins (id <> $1), not total — fail-safe on ties', () => {
    expect(ADMIN_USERS).toMatch(
      /role\s*=\s*'SUPER_ADMIN'\s+AND\s+is_active\s*=\s*true\s+AND\s+id\s*<>\s*\$1/i,
    );
  });
});

describe('setUserStatus — outstanding reset tokens are invalidated on leave-active', () => {
  // These two assertions catch the previous "consumed_at" typo by pinning the
  // EXACT column name from database/auth-hardening.sql:36 — used_at. The
  // earlier source-text ratchet greppped for the wrong literal and went green
  // while the fix was a silent no-op (the shim returns {error} envelopes,
  // not throws, so the surrounding try/catch never fired). The real
  // behavioural integration test lives below in
  // src/services/auth.lifecycle.resetTokens.test.ts so this regression can
  // never re-introduce a false green.
  it('targets the real password_reset_tokens.used_at column (not consumed_at)', () => {
    expect(AUTH_SERVICE).toMatch(/password_reset_tokens/);
    expect(AUTH_SERVICE).toMatch(/used_at[^,]*new Date\(\)\.toISOString\(\)/);
    expect(AUTH_SERVICE).not.toMatch(/consumed_at/);
  });

  it('only invalidates tokens that are still alive (.is used_at null)', () => {
    expect(AUTH_SERVICE).toMatch(/\.is\(\s*'used_at'\s*,\s*null\s*\)/);
  });

  it('destructures and logs the shim {error} envelope instead of relying on try/catch', () => {
    // The shim does NOT throw on DB error; it returns { data, error }. The
    // previous try/catch shape silently swallowed schema-drift failures.
    expect(AUTH_SERVICE).toMatch(/const\s*\{\s*error\s*:\s*resetErr\s*\}\s*=\s*await\s+db/);
    expect(AUTH_SERVICE).toMatch(/if\s*\(\s*resetErr\s*\)/);
  });
});

describe('invitation accept — atomic claim before side effects', () => {
  it('controller setup() claims the invitation via UPDATE WHERE status=PENDING RETURNING id', () => {
    expect(INVITATIONS_CTRL).toMatch(
      /UPDATE\s+public\.invitations[\s\S]*WHERE\s+id\s*=\s*\$1\s+AND\s+status\s*=\s*'PENDING'[\s\S]*RETURNING\s+id/i,
    );
  });

  it('service acceptInvitation() uses the same atomic claim shape', () => {
    expect(INVITATIONS_SVC).toMatch(
      /UPDATE\s+public\.invitations[\s\S]*WHERE\s+id\s*=\s*\$1\s+AND\s+status\s*=\s*'PENDING'[\s\S]*RETURNING\s+id/i,
    );
  });

  it('controller setup() reverts the claim on createUser / upsert failure (link stays usable)', () => {
    // revertClaim helper must exist AND be invoked from both failure branches.
    expect(INVITATIONS_CTRL).toMatch(/const revertClaim/);
    const calls = INVITATIONS_CTRL.match(/await revertClaim\(\)/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });
});
