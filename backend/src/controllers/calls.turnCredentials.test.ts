/**
 * Regression test for GET /calls/turn-credentials.
 *
 * Replaces hardcoded OpenRelay free TURN (the source of US↔India call
 * failures) with a stacked iceServers list:
 *   1. Cloudflare Realtime TURN (primary, global anycast edge)
 *   2. Metered.ca free TURN (fallback)
 *   3. Google STUN (always last)
 *
 * Each block is independently optional. Pins:
 *   - Cloudflare creds in env → endpoint POSTs to the right URL with the
 *     bearer token, surfaces the returned iceServer in the response.
 *   - Cloudflare API failure → endpoint degrades silently to Metered + STUN.
 *   - No providers configured → STUN-only response (lets dev/test work
 *     without external dependencies; same-WiFi calls still function).
 *   - Bearer token NEVER appears in the response body (defense-in-depth
 *     vs accidental leak of the Cloudflare API token to the browser).
 *   - Unauthenticated callers get 401.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { turnCredentials } from './calls.controller';

const mock = vi.hoisted(() => ({
  fetchCalls: [] as Array<{ url: string; init?: RequestInit }>,
  cloudflareResponse: null as null | {
    ok: boolean;
    status?: number;
    json?: () => Promise<unknown>;
  },
  envOverride: {
    cloudflareKeyId: '' as string,
    cloudflareToken: '' as string,
    meteredUsername: '' as string,
    meteredCredential: '' as string,
    meteredUrls: [] as string[],
    credentialTtlSeconds: 3600,
  },
}));

vi.mock('../config/env', () => ({
  get env() {
    return {
      turn: {
        cloudflare: {
          keyId: mock.envOverride.cloudflareKeyId || undefined,
          token: mock.envOverride.cloudflareToken || undefined,
        },
        metered: {
          username: mock.envOverride.meteredUsername || undefined,
          credential: mock.envOverride.meteredCredential || undefined,
          urls: mock.envOverride.meteredUrls,
        },
        credentialTtlSeconds: mock.envOverride.credentialTtlSeconds,
      },
    };
  },
}));

// Stub the rest of the call controller's dependency surface so importing it
// doesn't drag in pg / Postgres config.
vi.mock('../config/db', () => ({
  db: { from: () => ({}) },
  pool: { query: vi.fn() },
}));
vi.mock('../services/permission.service', () => ({ canMessageUser: vi.fn() }));
vi.mock('../services/realtime.service', () => ({ publishToUser: vi.fn() }));
vi.mock('../services/audit.service', () => ({ audit: vi.fn() }));
vi.mock('../config/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const originalFetch = global.fetch;
beforeEach(() => {
  mock.fetchCalls.length = 0;
  mock.cloudflareResponse = null;
  mock.envOverride = {
    cloudflareKeyId: '',
    cloudflareToken: '',
    meteredUsername: '',
    meteredCredential: '',
    meteredUrls: [],
    credentialTtlSeconds: 3600,
  };
  global.fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
    mock.fetchCalls.push({ url: String(url), init });
    if (!mock.cloudflareResponse) throw new Error('no response stubbed');
    return mock.cloudflareResponse as unknown as Response;
  }) as unknown as typeof fetch;
});

function mkRes() {
  const res: {
    statusCode: number;
    body: unknown;
    headers: Record<string, string>;
    status: (c: number) => any;
    json: (b: unknown) => any;
    set: (k: string, v: string) => any;
  } = {
    statusCode: 200,
    body: undefined,
    headers: {},
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(b) {
      this.body = b;
      return this;
    },
    set(k, v) {
      this.headers[k] = v;
      return this;
    },
  };
  return res;
}

async function call(user?: {
  id: string;
  role: string;
  email: string;
}): Promise<{ err: { status?: number } | null; res: ReturnType<typeof mkRes> }> {
  const res = mkRes();
  try {
    await (turnCredentials as any)({ user, body: {}, params: {}, log: console }, res, vi.fn());
    return { err: null, res };
  } catch (e) {
    return { err: e as { status?: number }, res };
  }
}

const USER = { id: 'u-1', role: 'CONSULTANT', email: 'c@x.test' };

afterEach(() => {
  global.fetch = originalFetch;
});

describe('calls.turnCredentials — auth', () => {
  it('401s when req.user is missing', async () => {
    const { err } = await call(undefined);
    expect(err?.status).toBe(401);
  });
});

describe('calls.turnCredentials — STUN-only fallback', () => {
  it('returns STUN-only when neither Cloudflare nor Metered are configured', async () => {
    const { err, res } = await call(USER);
    expect(err).toBeNull();
    const body = res.body as { iceServers: Array<{ urls: string | string[] }>; providers: any };
    expect(body.iceServers).toHaveLength(2);
    expect(body.iceServers[0]!.urls).toBe('stun:stun.l.google.com:19302');
    expect(body.iceServers[1]!.urls).toBe('stun:stun1.l.google.com:19302');
    expect(body.providers).toEqual({ cloudflare: false, metered: false });
    expect(mock.fetchCalls).toHaveLength(0);
  });
});

describe('calls.turnCredentials — ttl_seconds contract', () => {
  // The frontend's useCall.ts uses ttl_seconds to schedule a proactive
  // setConfiguration() refresh at ~85% of TTL. Audit caught the original
  // implementation drop the field — this pins the contract so the same
  // bug can't sneak back in.
  it('always includes ttl_seconds in the response body (defaults to 3600)', async () => {
    const { res } = await call(USER);
    const body = res.body as { ttl_seconds?: number };
    expect(typeof body.ttl_seconds).toBe('number');
    expect(body.ttl_seconds).toBe(3600);
  });

  it('reflects the configured TURN_CREDENTIAL_TTL_SECONDS in the response', async () => {
    mock.envOverride.credentialTtlSeconds = 1800;
    const { res } = await call(USER);
    const body = res.body as { ttl_seconds?: number };
    expect(body.ttl_seconds).toBe(1800);
  });

  it('uses the same TTL it advertises when calling Cloudflare', async () => {
    mock.envOverride.cloudflareKeyId = 'cf-key-id';
    mock.envOverride.cloudflareToken = 'cf-secret-token';
    mock.envOverride.credentialTtlSeconds = 7200;
    mock.cloudflareResponse = {
      ok: true,
      json: async () => ({
        iceServers: { urls: ['turn:cf-edge:3478'], username: 'u', credential: 'c' },
      }),
    };
    await call(USER);
    expect(JSON.parse(String(mock.fetchCalls[0]!.init?.body))).toEqual({ ttl: 7200 });
  });
});

describe('calls.turnCredentials — Cloudflare path', () => {
  beforeEach(() => {
    mock.envOverride.cloudflareKeyId = 'cf-key-id';
    mock.envOverride.cloudflareToken = 'cf-secret-token';
    mock.cloudflareResponse = {
      ok: true,
      json: async () => ({
        iceServers: {
          urls: ['turn:cf-edge.example:3478'],
          username: 'cf-user',
          credential: 'cf-cred',
        },
      }),
    };
  });

  it('POSTs to the Cloudflare credentials endpoint with the bearer token + TTL', async () => {
    await call(USER);
    expect(mock.fetchCalls).toHaveLength(1);
    const c = mock.fetchCalls[0]!;
    expect(c.url).toContain('rtc.live.cloudflare.com');
    expect(c.url).toContain('/keys/cf-key-id/credentials/generate');
    const headers = (c.init?.headers ?? {}) as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer cf-secret-token');
    expect(c.init?.method).toBe('POST');
    expect(JSON.parse(String(c.init?.body))).toEqual({ ttl: 3600 });
  });

  it('surfaces the Cloudflare iceServer entry in the response', async () => {
    const { res } = await call(USER);
    const body = res.body as { iceServers: any[]; providers: any };
    // First entry is the Cloudflare server, then 2x STUN (no Metered configured here).
    expect(body.iceServers[0]).toEqual({
      urls: ['turn:cf-edge.example:3478'],
      username: 'cf-user',
      credential: 'cf-cred',
    });
    expect(body.providers.cloudflare).toBe(true);
  });

  it('NEVER leaks the Cloudflare bearer token in the response body', async () => {
    const { res } = await call(USER);
    expect(JSON.stringify(res.body)).not.toContain('cf-secret-token');
  });

  it('degrades silently to Metered + STUN when Cloudflare API returns non-OK', async () => {
    mock.cloudflareResponse = { ok: false, status: 503 };
    mock.envOverride.meteredUsername = 'm-user';
    mock.envOverride.meteredCredential = 'm-cred';
    mock.envOverride.meteredUrls = ['turn:a.relay.metered.ca:80'];
    const { res } = await call(USER);
    const body = res.body as { iceServers: any[]; providers: any };
    // Cloudflare missing → Metered first, then STUN.
    expect(body.providers.cloudflare).toBe(false);
    expect(body.iceServers[0]).toMatchObject({ username: 'm-user', credential: 'm-cred' });
  });

  it('degrades silently when the Cloudflare fetch throws', async () => {
    global.fetch = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    const { err, res } = await call(USER);
    expect(err).toBeNull();
    const body = res.body as { providers: any; iceServers: any[] };
    expect(body.providers.cloudflare).toBe(false);
    // STUN-only because Metered isn't configured in this case.
    expect(body.iceServers).toHaveLength(2);
  });
});

describe('calls.turnCredentials — Metered fallback', () => {
  it('appends the Metered entry after Cloudflare when both are configured', async () => {
    mock.envOverride.cloudflareKeyId = 'cf-key';
    mock.envOverride.cloudflareToken = 'cf-token';
    mock.envOverride.meteredUsername = 'm-user';
    mock.envOverride.meteredCredential = 'm-cred';
    mock.envOverride.meteredUrls = [
      'turn:a.relay.metered.ca:80',
      'turn:a.relay.metered.ca:443?transport=tcp',
    ];
    mock.cloudflareResponse = {
      ok: true,
      json: async () => ({
        iceServers: {
          urls: 'turn:cf-edge.example:3478',
          username: 'cf-user',
          credential: 'cf-cred',
        },
      }),
    };
    const { res } = await call(USER);
    const body = res.body as { iceServers: any[]; providers: any };
    // Order matters: Cloudflare → Metered → 2x STUN. Browsers iterate in
    // order; Cloudflare must win when it's available.
    expect(body.iceServers).toHaveLength(4);
    expect(body.iceServers[0].username).toBe('cf-user');
    expect(body.iceServers[1].username).toBe('m-user');
    expect(body.iceServers[1].urls).toHaveLength(2);
    expect(String(body.iceServers[2].urls)).toContain('stun:');
    expect(body.providers).toEqual({ cloudflare: true, metered: true });
  });
});
