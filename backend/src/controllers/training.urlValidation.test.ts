/**
 * URL allowlist regression for the training controller.
 *
 * The Zod refinement `safeContentUrl` narrows `z.string().url()` (which by
 * itself happily accepts `javascript:`, `data:`, `ftp:`, `file:`) to:
 *   - https:// only
 *   - allow-listed host suffixes (own domain + the four embed providers).
 *
 * Without this refinement, a manager-tier user editing a lesson could plant a
 * `javascript:` URL into `video_url` / `document_url` / `file_url`. The
 * frontend iframe player would render it as the iframe src and execute the
 * payload in the parent origin's context : stored XSS.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../config/db', () => ({ db: {}, pool: { query: vi.fn() } }));
vi.mock('../config/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../config/anthropic', () => ({ ANTHROPIC_ENABLED: false, AI_AVAILABLE: false }));
vi.mock('../services/ai.service', () => ({ lessonCoach: vi.fn() }));
vi.mock('../services/trainingAI.service', () => ({
  generateCourseOutline: vi.fn(),
  generateLesson: vi.fn(),
  generateQuiz: vi.fn(),
}));
vi.mock('../services/trainingAchievements.service', () => ({
  evaluateAchievements: vi.fn(),
  logStudyMinutes: vi.fn(),
}));
vi.mock('../services/realtime.service', () => ({ publishToUser: vi.fn() }));
vi.mock('../services/groupScope', () => ({
  managerGroupUserIds: vi.fn(() => Promise.resolve(null)),
  leadCanAccessUser: vi.fn(() => Promise.resolve(true)),
  isGroupLead: vi.fn(() => false),
}));

const repoState = vi.hoisted(() => ({
  lastCreate: null as unknown,
  lastUpdate: null as unknown,
}));
vi.mock('../repositories/training.repository', () => ({
  assignments: {
    get: vi.fn(() => Promise.resolve({ data: null, error: null })),
  },
  courses: {
    create: vi.fn(async (input: unknown) => {
      repoState.lastCreate = input;
      return { data: { id: 'c-1', ...(input as object) }, error: null };
    }),
    update: vi.fn(async (_id: string, patch: unknown) => {
      repoState.lastUpdate = patch;
      return { data: { id: 'c-1', ...(patch as object) }, error: null };
    }),
    remove: vi.fn(() => Promise.resolve({ data: null, error: null })),
    get: vi.fn(() => Promise.resolve({ data: { id: 'c-1', created_by: 'u-1' }, error: null })),
  },
  lessons: {
    create: vi.fn(() => Promise.resolve({ data: null, error: null })),
  },
}));

import { createCourse } from './training.controller';

function mkRes() {
  const r: {
    statusCode: number;
    body: unknown;
    status: (c: number) => any;
    json: (b: unknown) => any;
  } = {
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
  return r;
}

async function callCreate(body: Record<string, unknown>) {
  const res = mkRes();
  try {
    await (createCourse as any)({ user: { id: 'u-1', role: 'SUPER_ADMIN' }, body }, res, vi.fn());
    return { err: null as any, res };
  } catch (e) {
    return { err: e as { status?: number; message?: string }, res };
  }
}

beforeEach(() => {
  repoState.lastCreate = null;
  repoState.lastUpdate = null;
});

describe('training.createCourse : thumbnail_url URL allowlist', () => {
  const BASE = { title: 'T', category: 'Technical Skills' };

  it('rejects javascript: scheme', async () => {
    const { err } = await callCreate({ ...BASE, thumbnail_url: 'javascript:alert(1)' });
    expect(err?.status).toBe(400);
    expect(repoState.lastCreate).toBeNull();
  });

  it('rejects data: scheme', async () => {
    const { err } = await callCreate({
      ...BASE,
      thumbnail_url: 'data:text/html,<script>alert(1)</script>',
    });
    expect(err?.status).toBe(400);
    expect(repoState.lastCreate).toBeNull();
  });

  it('rejects ftp: scheme', async () => {
    const { err } = await callCreate({ ...BASE, thumbnail_url: 'ftp://example.com/x.png' });
    expect(err?.status).toBe(400);
    expect(repoState.lastCreate).toBeNull();
  });

  it('rejects http:// (must be https)', async () => {
    const { err } = await callCreate({
      ...BASE,
      thumbnail_url: 'http://hireorbitai.com/img.png',
    });
    expect(err?.status).toBe(400);
    expect(repoState.lastCreate).toBeNull();
  });

  it('rejects an https URL on a non-allowlisted host', async () => {
    const { err } = await callCreate({ ...BASE, thumbnail_url: 'https://evil.test/img.png' });
    expect(err?.status).toBe(400);
    expect(repoState.lastCreate).toBeNull();
  });

  it('accepts an https URL on the own-domain allowlist', async () => {
    const { err } = await callCreate({
      ...BASE,
      thumbnail_url: 'https://hireorbitai.com/storage/img.png',
    });
    expect(err).toBeNull();
  });

  it('accepts a YouTube embed URL', async () => {
    const { err } = await callCreate({
      ...BASE,
      thumbnail_url: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
    });
    expect(err).toBeNull();
  });

  it('accepts null / omitted (optional field)', async () => {
    const { err: errNull } = await callCreate({ ...BASE, thumbnail_url: null });
    expect(errNull).toBeNull();
    const { err: errMissing } = await callCreate({ ...BASE });
    expect(errMissing).toBeNull();
  });
});
