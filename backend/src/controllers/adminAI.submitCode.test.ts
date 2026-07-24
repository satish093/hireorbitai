/**
 * Unit tests for submitClaudeCode in adminAI.controller.
 *
 * This handler feeds the browser-issued OAuth authorization code to the waiting
 * `claude auth login` process's stdin (see the "Re-authenticate Claude CLI"
 * flow). We can't exercise the happy path here — that requires a live spawned
 * process — but the two reject paths are pure and security-relevant:
 *   - unknown session   → 404 (no existence oracle, mirrors getLoginStatus)
 *   - invalid/strict body → 400 (mass-assignment guard per .claude/rules/security.md)
 *
 * config/logger pulls in config/env (fail-fasts without env), so it's mocked at
 * module load before the controller is imported.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../config/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { submitClaudeCode } from './adminAI.controller';
import type { ApiError } from '../types';

function fakeRes() {
  const res: { body?: unknown; json: (b: unknown) => void } = {
    json(b: unknown) {
      this.body = b;
    },
  };
  return res;
}

const next = vi.fn();

function run(params: Record<string, string>, body: unknown) {
  const req = { params, body } as never;
  const res = fakeRes();
  // submitClaudeCode is synchronous and throws httpError on the reject paths.
  try {
    submitClaudeCode(req, res as never, next);
    return { thrown: null as ApiError | null, res };
  } catch (err) {
    return { thrown: err as ApiError, res };
  }
}

describe('submitClaudeCode', () => {
  it('rejects a body with no code (400)', () => {
    const { thrown } = run({ sessionId: 'whatever' }, {});
    expect(thrown?.status).toBe(400);
  });

  it('rejects a body with extra keys via the strict schema (400)', () => {
    const { thrown } = run(
      { sessionId: 'whatever' },
      { code: 'a-valid-looking-code', token: 'sk-injected' },
    );
    expect(thrown?.status).toBe(400);
  });

  it('rejects a too-short code (400)', () => {
    const { thrown } = run({ sessionId: 'whatever' }, { code: 'short' });
    expect(thrown?.status).toBe(400);
  });

  it('returns 404 for an unknown session with an otherwise-valid code', () => {
    const { thrown } = run({ sessionId: 'does-not-exist' }, { code: 'a-valid-looking-code-1234' });
    expect(thrown?.status).toBe(404);
  });
});
