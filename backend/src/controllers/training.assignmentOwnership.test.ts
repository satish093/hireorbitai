/**
 * Assignment-ownership tests for training.controller.
 *
 * Two code paths gate access to a training assignment by ownership:
 *   - getAssignment: inline check — non-manager whose assigned_to_user_id !=
 *     caller gets httpError(404, 'Not found') (existence-oracle safe).
 *   - assertCanReadAssignment (used by getAcknowledgement / getCompletionGates /
 *     complianceReport): same rule, factored into a helper.
 *
 * This pins: the assignment owner passes, a manager-tier caller passes, and a
 * DIFFERENT consultant gets 404 — for both the inline path and the helper path.
 *
 * The controller talks to repositories + services rather than db directly, so
 * those modules are mocked (which also keeps importing it away from config/env).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  // The single assignment row repo.assignments.get resolves to.
  assignment: null as Record<string, unknown> | null,
}));

vi.mock('../repositories/training.repository', () => {
  const empty = () => Promise.resolve({ data: [], error: null });
  return {
    assignments: {
      get: vi.fn(() => Promise.resolve({ data: mock.assignment, error: null })),
    },
    progress: { listForAssignment: empty },
    uploads: { listForAssignment: empty },
    feedback: { listForAssignment: empty },
    quizAttempts: { listForAssignment: empty },
    acknowledgements: {
      getForAssignment: vi.fn(() => Promise.resolve({ data: null, error: null })),
    },
  };
});

vi.mock('../services/training.service', () => ({
  resolveAssignmentContent: vi.fn(() => Promise.resolve({})),
  stripQuizAnswers: vi.fn((c: unknown) => c),
  evaluateCompletion: vi.fn(() => Promise.resolve({ blockers: [], progress_percentage: 0 })),
}));

vi.mock('../config/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../services/trainingAI.service', () => ({}));
vi.mock('../services/trainingAchievements.service', () => ({
  evaluateAchievements: vi.fn(),
  logStudyMinutes: vi.fn(),
}));

import { getAssignment, getAcknowledgement } from './training.controller';

type Handler = (req: any, res: any, next: any) => unknown | Promise<unknown>;

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
  handler: Handler,
  user: { id: string; role: string },
): Promise<{ status?: number } | null> {
  try {
    await handler({ user, params: { id: 'a-1' }, query: {} }, mkRes(), vi.fn());
    return null;
  } catch (e) {
    return e as { status?: number };
  }
}

beforeEach(() => {
  mock.assignment = null;
  vi.clearAllMocks();
});

const OWNER = { id: 'u-owner', role: 'CONSULTANT' };
const OTHER = { id: 'u-other', role: 'CONSULTANT' };
const MANAGER = { id: 'u-mgr', role: 'MANAGER' };

describe('training.controller — getAssignment ownership (inline)', () => {
  it('the assignment owner is allowed', async () => {
    mock.assignment = { id: 'a-1', assigned_to_user_id: OWNER.id, course_id: 'c-1' };
    const err = await call(getAssignment as Handler, OWNER);
    expect(err).toBeNull();
  });

  it('a manager-tier caller is allowed for any assignment', async () => {
    mock.assignment = { id: 'a-1', assigned_to_user_id: OWNER.id, course_id: 'c-1' };
    const err = await call(getAssignment as Handler, MANAGER);
    expect(err).toBeNull();
  });

  it('a different consultant gets 404 (not 403)', async () => {
    mock.assignment = { id: 'a-1', assigned_to_user_id: OWNER.id, course_id: 'c-1' };
    const err = await call(getAssignment as Handler, OTHER);
    expect(err?.status).toBe(404);
  });

  it('a missing assignment yields 404', async () => {
    mock.assignment = null;
    const err = await call(getAssignment as Handler, OWNER);
    expect(err?.status).toBe(404);
  });
});

describe('training.controller — assertCanReadAssignment (via getAcknowledgement)', () => {
  it('the assignment owner is allowed', async () => {
    mock.assignment = { id: 'a-1', assigned_to_user_id: OWNER.id };
    const err = await call(getAcknowledgement as Handler, OWNER);
    expect(err).toBeNull();
  });

  it('a manager-tier caller is allowed', async () => {
    mock.assignment = { id: 'a-1', assigned_to_user_id: OWNER.id };
    const err = await call(getAcknowledgement as Handler, MANAGER);
    expect(err).toBeNull();
  });

  it('a different consultant gets 404 (not 403)', async () => {
    mock.assignment = { id: 'a-1', assigned_to_user_id: OWNER.id };
    const err = await call(getAcknowledgement as Handler, OTHER);
    expect(err?.status).toBe(404);
  });
});
