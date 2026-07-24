/**
 * Regression test for OWNER_TIER credential isolation on
 * POST /training/lessons/:id/generate-content.
 *
 * Bug story: every ADMIN_TIER caller (including DIRECTOR/CTO) could pass
 * an aiToken in the body OR silently trigger the server's
 * ANTHROPIC_OAUTH_TOKEN (Claude Max subscription) fallback. That meant:
 *   1. DIRECTOR/CTO insider drains the SUPER_ADMIN's Claude Max quota.
 *   2. The endpoint acts as a token-validity oracle for any ADMIN_TIER caller
 *      (success vs SDK-shaped error reveals key validity).
 *   3. No audit trail of who used which credential mode.
 *
 * Fix: handler now requires OWNER_TIER for aiToken acceptance AND for the
 * OAUTH fallback path. ADMIN_TIER (non-owner) always falls through to the
 * global API-key client. Every call emits a `training_ai_generate` audit
 * row with the credential_mode metadata.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  auditCalls: [] as Array<{
    action: string;
    user_id?: string | null;
    metadata?: Record<string, unknown>;
  }>,
  // Capture the constructor options of the Anthropic SDK so we can assert
  // which credential mode was wired up per call.
  sdkConstructions: [] as Array<{ apiKey?: string; authToken?: string }>,
  // What the AI service returns — let the success path complete so we can
  // observe credential mode + audit emission.
  aiResult: {
    content: 'lesson body',
    practical_example: 'ex',
    exercises: [],
    key_takeaways: ['k1'],
    quiz: [],
  },
  oauthEnv: '',
}));

vi.mock('@anthropic-ai/sdk', () => {
  class FakeSDK {
    constructor(opts: { apiKey?: string; authToken?: string }) {
      mock.sdkConstructions.push(opts);
    }
  }
  return { default: FakeSDK };
});

vi.mock('../repositories/training.repository', () => ({
  lessons: {
    get: vi.fn(async () => ({
      data: { id: 'l-1', course_id: 'c-1', title: 'T', summary: 's', lesson_objective: 'o' },
      error: null,
    })),
    update: vi.fn(async () => ({ data: { id: 'l-1' }, error: null })),
  },
  courses: {
    get: vi.fn(async () => ({
      data: { id: 'c-1', title: 'CT', category: 'cat', difficulty: 'BEGINNER' },
      error: null,
    })),
  },
  quizzes: {
    removeForLesson: vi.fn(async () => ({ error: null })),
    createMany: vi.fn(async () => ({ error: null })),
  },
}));

vi.mock('../services/training.service', () => ({}));
vi.mock('../services/trainingAI.service', () => ({
  generateLessonContent: vi.fn(async (_input: unknown, opts: { client?: unknown }) => {
    // Capture which client was passed (undefined = global path).
    mock.sdkConstructions.push({ apiKey: opts.client ? '[custom]' : '[global]' });
    return { data: mock.aiResult };
  }),
}));
vi.mock('../services/ai.service', () => ({ lessonCoach: vi.fn() }));
vi.mock('../config/anthropic', () => ({ ANTHROPIC_ENABLED: true }));
vi.mock('../services/realtime.service', () => ({
  publishToUser: vi.fn(async () => undefined),
}));
vi.mock('../services/groupScope', () => ({
  managerGroupUserIds: vi.fn(async () => null),
  leadCanAccessUser: vi.fn(async () => true),
  isGroupLead: () => false,
}));
vi.mock('../services/trainingAchievements.service', () => ({
  evaluateAchievements: vi.fn(),
  logStudyMinutes: vi.fn(),
}));
vi.mock('../services/audit.service', () => ({
  audit: (entry: {
    action: string;
    user_id?: string | null;
    metadata?: Record<string, unknown>;
  }) => {
    mock.auditCalls.push(entry);
  },
}));
vi.mock('../config/db', () => ({ db: { from: () => ({}) }, pool: {} }));
vi.mock('../config/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { generateLessonContent } from './training.controller';

function mkRes() {
  const res: any = {
    statusCode: 200,
    body: undefined,
    status(c: number) {
      this.statusCode = c;
      return this;
    },
    json(b: unknown) {
      this.body = b;
      return this;
    },
  };
  return res;
}

async function call(
  user: { id: string; role: string; email: string },
  body: unknown = {},
): Promise<{ err: { status?: number } | null; res: ReturnType<typeof mkRes> }> {
  const res = mkRes();
  try {
    await (generateLessonContent as any)(
      { user, body, params: { id: 'l-1' }, ip: '127.0.0.1', headers: {} },
      res,
      vi.fn(),
    );
    return { err: null, res };
  } catch (e) {
    return { err: e as { status?: number }, res };
  }
}

beforeEach(() => {
  mock.auditCalls.length = 0;
  mock.sdkConstructions.length = 0;
  process.env.ANTHROPIC_OAUTH_TOKEN = mock.oauthEnv;
});

describe('training.generateLessonContent — credential isolation', () => {
  it('SUPER_ADMIN with body aiToken: builds custom client, audits credential_mode=body_token', async () => {
    const { err } = await call(
      { id: 'u-sa', role: 'SUPER_ADMIN', email: 'sa@x.test' },
      { aiToken: 'sk-test-1234567890abcdef' },
    );
    expect(err).toBeNull();
    // Two entries: one constructor call from the handler, one wrapper call from
    // the mocked ai.generateLessonContent that records [custom] vs [global].
    expect(mock.sdkConstructions.some((c) => c.apiKey === 'sk-test-1234567890abcdef')).toBe(true);
    expect(mock.sdkConstructions.some((c) => c.apiKey === '[custom]')).toBe(true);
    const a = mock.auditCalls.find((a) => a.action === 'training_ai_generate');
    expect(a).toBeDefined();
    expect(a?.metadata?.credential_mode).toBe('body_token');
  });

  it('CEO with body OAuth-style aiToken: uses authToken constructor (not apiKey)', async () => {
    const { err } = await call(
      { id: 'u-ceo', role: 'CEO', email: 'ceo@x.test' },
      { aiToken: 'oauth-style-token-1234567890' },
    );
    expect(err).toBeNull();
    expect(
      mock.sdkConstructions.find((c) => c.authToken === 'oauth-style-token-1234567890'),
    ).toBeDefined();
  });

  it('DIRECTOR with body aiToken: 403 + denied audit (token never reaches SDK)', async () => {
    const { err } = await call(
      { id: 'u-dir', role: 'DIRECTOR', email: 'dir@x.test' },
      { aiToken: 'sk-attacker-1234567890' },
    );
    expect(err?.status).toBe(403);
    const denied = mock.auditCalls.find(
      (a) => a.metadata?.credential_mode === 'body_token_rejected',
    );
    expect(denied).toBeDefined();
    // The attacker token must NEVER have reached the SDK constructor.
    expect(
      mock.sdkConstructions.find((c) => c.apiKey === 'sk-attacker-1234567890'),
    ).toBeUndefined();
  });

  it('CTO with body aiToken: 403 (same as DIRECTOR — ADMIN_TIER without owner)', async () => {
    const { err } = await call(
      { id: 'u-cto', role: 'CTO', email: 'cto@x.test' },
      { aiToken: 'sk-attacker' },
    );
    expect(err?.status).toBe(403);
  });

  it('DIRECTOR with no body token: NO custom client built — falls through to global (credential_mode=global)', async () => {
    mock.oauthEnv = 'should-not-be-used-by-director-1234567890';
    process.env.ANTHROPIC_OAUTH_TOKEN = mock.oauthEnv;
    const { err } = await call({ id: 'u-dir', role: 'DIRECTOR', email: 'dir@x.test' }, {});
    expect(err).toBeNull();
    // Only the wrapper call should have run with the [global] marker — no
    // explicit SDK construction.
    const explicit = mock.sdkConstructions.filter(
      (c) => c.authToken === mock.oauthEnv || c.apiKey?.startsWith('sk-'),
    );
    expect(explicit).toHaveLength(0);
    const a = mock.auditCalls.find((a) => a.action === 'training_ai_generate');
    expect(a?.metadata?.credential_mode).toBe('global');
  });

  it('SUPER_ADMIN with no body token + OAUTH env set: uses OAUTH client (credential_mode=server_oauth)', async () => {
    mock.oauthEnv = 'oauth-server-token-1234567890';
    process.env.ANTHROPIC_OAUTH_TOKEN = mock.oauthEnv;
    const { err } = await call({ id: 'u-sa', role: 'SUPER_ADMIN', email: 'sa@x.test' }, {});
    expect(err).toBeNull();
    expect(mock.sdkConstructions.find((c) => c.authToken === mock.oauthEnv)).toBeDefined();
    const a = mock.auditCalls.find((a) => a.action === 'training_ai_generate');
    expect(a?.metadata?.credential_mode).toBe('server_oauth');
  });

  it('rejects unknown body keys (strict schema)', async () => {
    const { err } = await call(
      { id: 'u-sa', role: 'SUPER_ADMIN', email: 'sa@x.test' },
      { aiToken: 'sk-ok-1234567890', mode: 'override' },
    );
    expect(err?.status).toBe(400);
  });
});
