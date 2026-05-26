/**
 * Production-safety guard for the development-only surface.
 *
 * `requireDevTools` must 404 (not 403 — no existence oracle) whenever dev
 * tooling is off, and call through only when `env.devTools` is true. Combined
 * with the derivation in config/env.ts (`devTools = DEV_TOOLS && NODE_ENV !==
 * 'production'`), this is the single gate that keeps the /auth/dev/* and /dev/*
 * routes invisible in production.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFlags = vi.hoisted(() => ({ devTools: false }));

vi.mock('../config/db', () => ({ db: {}, pool: {} }));
vi.mock('../config/env', () => ({
  env: {
    get devTools() {
      return mockFlags.devTools;
    },
  },
}));

import { requireDevTools } from './auth';

function run(): { err: { status?: number } | null; nextCalled: boolean } {
  let nextCalled = false;
  try {
    requireDevTools({} as any, {} as any, () => {
      nextCalled = true;
    });
    return { err: null, nextCalled };
  } catch (e) {
    return { err: e as { status?: number }, nextCalled };
  }
}

beforeEach(() => {
  mockFlags.devTools = false;
});

describe('requireDevTools', () => {
  it('404s when dev tooling is off (invisible in production)', () => {
    mockFlags.devTools = false;
    const { err, nextCalled } = run();
    expect(err?.status).toBe(404);
    expect(nextCalled).toBe(false);
  });

  it('calls next when dev tooling is on', () => {
    mockFlags.devTools = true;
    const { err, nextCalled } = run();
    expect(err).toBeNull();
    expect(nextCalled).toBe(true);
  });
});
