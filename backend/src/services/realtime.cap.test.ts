/**
 * Regression test for the per-user SSE connection cap.
 *
 * Bug: subscribers Map<userId,Set<Handler>> was unbounded; one authenticated
 * user could hold thousands of SSE connections, exhausting file descriptors
 * + saturating the PG LISTEN/NOTIFY channel. The token-issuance path only
 * logged a warning above 10k entries.
 *
 * Fix: subscribe() throws 429 once a user is at MAX_SSE_PER_USER active
 * connections; unsubscribe frees a slot. This test exercises both edges
 * AND verifies that a DIFFERENT user is unaffected by another user
 * hitting the cap.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../config/env', () => ({ env: {} }));
vi.mock('../config/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
// realtime.service imports pg and tries to wire a LISTEN client at boot.
// Stub it so the import doesn't reach Postgres in tests.
vi.mock('pg', () => ({
  Client: class {
    connect() {
      return Promise.resolve();
    }
    query() {
      return Promise.resolve();
    }
    on() {}
    end() {
      return Promise.resolve();
    }
  },
  Pool: class {
    query() {
      return Promise.resolve({ rows: [] });
    }
  },
}));
vi.mock('../config/db', () => ({ pool: { query: vi.fn(async () => ({ rows: [] })) } }));

import { subscribe, MAX_SSE_PER_USER } from './realtime.service';

beforeEach(() => {
  // No global state to reset — each test uses a fresh userId.
});

describe('realtime.subscribe — per-user connection cap', () => {
  it('accepts up to MAX_SSE_PER_USER concurrent subscriptions per user', async () => {
    const userId = 'cap-user-1';
    const unsubs: Array<() => void> = [];
    for (let i = 0; i < MAX_SSE_PER_USER; i++) {
      const u = await subscribe(userId, () => {});
      unsubs.push(u);
    }
    expect(unsubs).toHaveLength(MAX_SSE_PER_USER);
    unsubs.forEach((u) => u());
  });

  it('throws 429 on the (MAX+1)th subscription for the same user', async () => {
    const userId = 'cap-user-2';
    const unsubs: Array<() => void> = [];
    for (let i = 0; i < MAX_SSE_PER_USER; i++) {
      unsubs.push(await subscribe(userId, () => {}));
    }
    let thrown: { status?: number } | null = null;
    try {
      await subscribe(userId, () => {});
    } catch (e) {
      thrown = e as { status?: number };
    }
    expect(thrown?.status).toBe(429);
    unsubs.forEach((u) => u());
  });

  it('unsubscribing one connection frees a slot for the same user', async () => {
    const userId = 'cap-user-3';
    const unsubs: Array<() => void> = [];
    for (let i = 0; i < MAX_SSE_PER_USER; i++) {
      unsubs.push(await subscribe(userId, () => {}));
    }
    // Free one slot, retry.
    unsubs[0]!();
    const fresh = await subscribe(userId, () => {});
    expect(typeof fresh).toBe('function');
    unsubs.slice(1).forEach((u) => u());
    fresh();
  });

  it('a different user is NOT throttled by another user hitting the cap', async () => {
    const userA = 'cap-user-4-a';
    const userB = 'cap-user-4-b';
    const aUnsubs: Array<() => void> = [];
    for (let i = 0; i < MAX_SSE_PER_USER; i++) {
      aUnsubs.push(await subscribe(userA, () => {}));
    }
    // user A is at the cap; user B starts fresh and must be admitted.
    const bUnsub = await subscribe(userB, () => {});
    expect(typeof bUnsub).toBe('function');
    aUnsubs.forEach((u) => u());
    bUnsub();
  });
});
