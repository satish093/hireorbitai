/**
 * Feature Flags route-gate regression — exercises the middleware chain
 * actually wired in featureFlags.routes.ts.
 *
 * Policy (docs/rbac-overview.html → "Feature Flags"):
 *   READ  (GET /, GET /overrides)   → ADMIN_TIER (incl. CTO + Director)
 *                                      OR a DEVELOPER granted `feature_flags`.
 *   WRITE (PATCH /:key, PUT /groups/:groupId/:key) → OWNER_TIER ONLY
 *                                      (SUPER_ADMIN + CEO). A DEVELOPER with
 *                                      `feature_flags` may READ but never WRITE.
 *
 * A future refactor that swaps `requireRole(...OWNER_TIER)` back to
 * `requireRoleOrCapability` for writes — which would silently grant a
 * Developer the ability to flip flags — fails loudly here.
 *
 * Avoids supertest (not a dep) by walking the router stack and invoking
 * the middleware functions manually.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stub heavy module-load-time deps so importing the router doesn't pull in
// pg / env. The route file imports auth middleware which imports config/db.
vi.mock('../config/db', () => ({ db: { from: () => ({}) }, pool: {} }));
vi.mock('../config/env', () => ({ env: {} }));
vi.mock('../config/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Stub controllers so we can confirm whether the middleware let the request
// through without ever touching real flag state.
const controllerSpies = vi.hoisted(() => ({
  list: vi.fn(),
  listOverrides: vi.fn(),
  setFlag: vi.fn(),
  setGroupOverride: vi.fn(),
  myFlags: vi.fn(),
}));
vi.mock('../controllers/featureFlags.controller', () => controllerSpies);

import { featureFlagsRouter } from './featureFlags.routes';

interface AuthedUser {
  id: string;
  role: string;
  email: string;
  capabilities?: string[];
}

/**
 * Find the registered handlers for a `(method, path)` on the router and run
 * the middleware chain in sequence, threading req → next. Returns the HTTP
 * status that the chain wrote (or that an httpError thrown along the way
 * implies). Stops at the first non-200 OR when the controller stub is hit.
 */
async function runRoute(
  method: 'get' | 'post' | 'patch' | 'put' | 'delete',
  path: string,
  user: AuthedUser | null,
): Promise<{ status: number; reachedController: boolean }> {
  const stack = (featureFlagsRouter as unknown as { stack: any[] }).stack;
  const layer = stack.find((l: any) => {
    if (!l.route) return false;
    if (l.route.path !== path) return false;
    return !!l.route.methods?.[method];
  });
  if (!layer) throw new Error(`No layer for ${method.toUpperCase()} ${path}`);
  const handlers: ((req: any, res: any, next: any) => unknown)[] = layer.route.stack.map(
    (s: any) => s.handle,
  );

  let status = 200;
  let reachedController = false;
  const req: any = { user, params: {}, body: {}, query: {} };
  const res: any = {
    statusCode: 200,
    status(c: number) {
      res.statusCode = c;
      return res;
    },
    json() {
      reachedController = true;
      return res;
    },
  };

  for (const h of handlers) {
    // The controller stubs are mocks — calling them counts as "reached".
    // Detect by checking whether the function is one of our spies.
    if ((Object.values(controllerSpies) as unknown[]).includes(h)) {
      reachedController = true;
      break;
    }
    let nextCalled = false;
    let thrown: { status?: number } | null = null;
    try {
      await h(req, res, (err?: unknown) => {
        if (err) thrown = err as { status?: number };
        else nextCalled = true;
      });
    } catch (e) {
      thrown = e as { status?: number };
    }
    if (thrown) {
      status = thrown.status ?? 500;
      break;
    }
    if (!nextCalled) break;
  }
  return { status, reachedController };
}

beforeEach(() => {
  for (const fn of Object.values(controllerSpies)) (fn as { mockClear: () => void }).mockClear();
});

const SA = { id: 'u-sa', role: 'SUPER_ADMIN', email: 'sa@x.test' };
const CEO = { id: 'u-ceo', role: 'CEO', email: 'ceo@x.test' };
const CTO = { id: 'u-cto', role: 'CTO', email: 'cto@x.test' };
const DIRECTOR = { id: 'u-dir', role: 'DIRECTOR', email: 'dir@x.test' };
const HR = { id: 'u-hr', role: 'HR_MANAGER', email: 'hr@x.test' };
const DEV_WITH_CAP: AuthedUser = {
  id: 'u-dev',
  role: 'DEVELOPER',
  email: 'dev@x.test',
  capabilities: ['feature_flags'],
};
const DEV_NO_CAP: AuthedUser = { id: 'u-dev2', role: 'DEVELOPER', email: 'dev2@x.test' };

// ─── READ ──────────────────────────────────────────────────────────────────
describe('GET /feature-flags — read access (ADMIN_TIER or DEVELOPER w/ feature_flags)', () => {
  it.each([
    ['SUPER_ADMIN', SA, true],
    ['CEO', CEO, true],
    ['CTO', CTO, true],
    ['DIRECTOR', DIRECTOR, true],
    ['HR_MANAGER', HR, false],
    ['DEVELOPER w/ feature_flags', DEV_WITH_CAP, true],
    ['DEVELOPER w/o capability', DEV_NO_CAP, false],
  ])('%s → %s', async (_label, user, shouldPass) => {
    const { status, reachedController } = await runRoute('get', '/', user);
    if (shouldPass) {
      expect(reachedController).toBe(true);
    } else {
      expect(status).toBe(403);
      expect(reachedController).toBe(false);
    }
  });
});

// ─── WRITE ─────────────────────────────────────────────────────────────────
describe('PATCH /feature-flags/:key — write access is OWNER_TIER only', () => {
  it.each([
    ['SUPER_ADMIN', SA, true],
    ['CEO', CEO, true],
    ['CTO', CTO, false],
    ['DIRECTOR', DIRECTOR, false],
    ['HR_MANAGER', HR, false],
    ['DEVELOPER w/ feature_flags (read cap, NOT write)', DEV_WITH_CAP, false],
    ['DEVELOPER w/o capability', DEV_NO_CAP, false],
  ])('%s → %s', async (_label, user, shouldPass) => {
    const { status, reachedController } = await runRoute('patch', '/:key', user);
    if (shouldPass) {
      expect(reachedController).toBe(true);
    } else {
      expect(status).toBe(403);
      expect(reachedController).toBe(false);
    }
  });
});

describe('PUT /feature-flags/groups/:groupId/:key — group-override write is OWNER_TIER only', () => {
  it('CTO is rejected (403)', async () => {
    const { status, reachedController } = await runRoute('put', '/groups/:groupId/:key', CTO);
    expect(status).toBe(403);
    expect(reachedController).toBe(false);
  });
  it('Developer with feature_flags capability is rejected (403)', async () => {
    const { status, reachedController } = await runRoute(
      'put',
      '/groups/:groupId/:key',
      DEV_WITH_CAP,
    );
    expect(status).toBe(403);
    expect(reachedController).toBe(false);
  });
  it('CEO succeeds (reaches controller)', async () => {
    const { reachedController } = await runRoute('put', '/groups/:groupId/:key', CEO);
    expect(reachedController).toBe(true);
  });
});
