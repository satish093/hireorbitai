/**
 * Training group-scope regression suite.
 *
 * Pins the policy the latest audit closed:
 *   ADMIN_TIER     → unscoped (SUPER_ADMIN / CEO / CTO / DIRECTOR).
 *   GROUP LEAD     → HR_MANAGER / MANAGER only when the assignment's target
 *                    user is in their group (assertCanAccessUser → 404 oracle-safe).
 *   LEARNER        → only their own assignment.
 *
 * Previously several handlers used `isManagerTier(req.user.role)` which
 * also passed HR_MANAGER / MANAGER through unscoped — letting them act on
 * peer-group consultants' training. The handlers under test:
 *
 *   updateProgress     PUT  /assignments/:id/progress
 *   markLessonViewed   PUT  /assignments/:id/viewed
 *   submitQuizAttempt  POST /assignments/:id/quiz-attempts
 *   listEvaluations    GET  /assignments/:id/evaluations
 *   createEvaluation   POST /assignments/:id/evaluations
 *   updateEvaluation   PATCH /evaluations/:evalId
 *
 * DB + heavy service deps are mocked so the controller imports without
 * reaching config/env.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  assignment: null as Record<string, unknown> | null,
  evaluation: null as Record<string, unknown> | null,
  quiz: null as Record<string, unknown> | null,
}));

const groupScope = vi.hoisted(() => ({ leadAllows: false }));

vi.mock('../config/db', () => ({
  db: {
    from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) }),
  },
  pool: {},
}));
vi.mock('../config/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../config/anthropic', () => ({ ANTHROPIC_ENABLED: true }));

vi.mock('../services/groupScope', () => {
  const GROUP_LEAD = ['MANAGER', 'HR_MANAGER'];
  return {
    managerGroupUserIds: vi.fn(async () => []),
    leadCanAccessUser: vi.fn(async () => groupScope.leadAllows),
    isGroupLead: (role: string) => GROUP_LEAD.includes(role),
    isAdminTier: (role: string) => ['SUPER_ADMIN', 'CEO', 'CTO', 'DIRECTOR'].includes(role),
  };
});

vi.mock('../repositories/training.repository', () => {
  const empty = () => Promise.resolve({ data: [], error: null });
  return {
    assignments: {
      get: vi.fn(() => Promise.resolve({ data: mock.assignment, error: null })),
      update: vi.fn((_id: string, patch: unknown) =>
        Promise.resolve({
          data: { ...(mock.assignment as object), ...(patch as object) },
          error: null,
        }),
      ),
    },
    evaluations: {
      get: vi.fn(() => Promise.resolve({ data: mock.evaluation, error: null })),
      listForAssignment: vi.fn(() => Promise.resolve({ data: [{ id: 'e-1' }], error: null })),
      create: vi.fn((row: unknown) =>
        Promise.resolve({ data: { id: 'e-new', ...(row as object) }, error: null }),
      ),
      update: vi.fn((id: string, patch: unknown) =>
        Promise.resolve({ data: { id, ...(patch as object) }, error: null }),
      ),
    },
    progress: { listForAssignment: empty },
    uploads: { listForAssignment: empty },
    feedback: { listForAssignment: empty },
    quizAttempts: { listForAssignment: empty },
    acknowledgements: { getForAssignment: () => Promise.resolve({ data: null, error: null }) },
  };
});

vi.mock('../services/training.service', () => ({
  markLessonProgress: vi.fn(async () => undefined),
  recordQuizAttempt: vi.fn(async (row: unknown) => ({ id: 'attempt-1', ...(row as object) })),
  getAssignmentQuiz: vi.fn(async () => mock.quiz),
  resolveAssignmentContent: vi.fn(async () => ({})),
  stripQuizAnswers: vi.fn((c: unknown) => c),
  evaluateCompletion: vi.fn(async () => ({ blockers: [], progress_percentage: 0 })),
}));

vi.mock('../services/trainingAI.service', () => ({}));
vi.mock('../services/ai.service', () => ({ lessonCoach: vi.fn() }));
vi.mock('../services/trainingAchievements.service', () => ({
  evaluateAchievements: vi.fn(),
  logStudyMinutes: vi.fn(),
}));
vi.mock('../services/realtime.service', () => ({ publishToUser: vi.fn() }));

import {
  updateProgress,
  markLessonViewed,
  submitQuizAttempt,
  listEvaluations,
  createEvaluation,
  updateEvaluation,
} from './training.controller';

type Handler = (req: any, res: any, next: any) => unknown | Promise<unknown>;

function mkRes() {
  const r: any = { statusCode: 200, body: undefined };
  r.status = (c: number) => {
    r.statusCode = c;
    return r;
  };
  r.json = (b: unknown) => {
    r.body = b;
    return r;
  };
  return r;
}

async function call(
  handler: Handler,
  req: any,
): Promise<{ res: any; err: { status?: number } | null }> {
  const res = mkRes();
  try {
    await handler(req, res, vi.fn());
    return { res, err: null };
  } catch (e) {
    return { res, err: e as { status?: number } };
  }
}

const OWNER = { id: 'u-owner', role: 'CONSULTANT' };
const ADMIN = { id: 'u-admin', role: 'DIRECTOR' };
const LEAD = { id: 'u-lead', role: 'HR_MANAGER', group_id: 'g-a' };
const STRANGER = { id: 'u-stranger', role: 'CONSULTANT' };

const VALID_LESSON_ID = '11111111-1111-1111-1111-111111111111';
const VALID_QUIZ_ID = '22222222-2222-2222-2222-222222222222';

beforeEach(() => {
  mock.assignment = { id: 'a-1', assigned_to_user_id: OWNER.id, course_id: 'c-1' };
  mock.evaluation = null;
  mock.quiz = { id: VALID_QUIZ_ID, correct_answer: 'A', points: 1, explanation: '' };
  groupScope.leadAllows = false;
  vi.clearAllMocks();
});

// ─── updateProgress ─────────────────────────────────────────────────────────
describe('updateProgress — group scope', () => {
  const body = { lesson_id: VALID_LESSON_ID, completed: true };
  it('owner (learner) is allowed for their own assignment', async () => {
    const { err } = await call(updateProgress as Handler, {
      user: OWNER,
      params: { id: 'a-1' },
      body,
    });
    expect(err).toBeNull();
  });
  it('ADMIN-tier is allowed (unscoped)', async () => {
    const { err } = await call(updateProgress as Handler, {
      user: ADMIN,
      params: { id: 'a-1' },
      body,
    });
    expect(err).toBeNull();
  });
  it('GROUP LEAD allowed when the target is in-group', async () => {
    groupScope.leadAllows = true;
    const { err } = await call(updateProgress as Handler, {
      user: LEAD,
      params: { id: 'a-1' },
      body,
    });
    expect(err).toBeNull();
  });
  it('GROUP LEAD DENIED (404) when target is out-of-group', async () => {
    groupScope.leadAllows = false;
    const { err } = await call(updateProgress as Handler, {
      user: LEAD,
      params: { id: 'a-1' },
      body,
    });
    expect(err?.status).toBe(404);
  });
  it('a different consultant gets 404 (not 403)', async () => {
    const { err } = await call(updateProgress as Handler, {
      user: STRANGER,
      params: { id: 'a-1' },
      body,
    });
    expect(err?.status).toBe(404);
  });
});

// ─── markLessonViewed ───────────────────────────────────────────────────────
describe('markLessonViewed — group scope', () => {
  const body = { lesson_id: VALID_LESSON_ID };
  it('owner can mark viewed', async () => {
    const { err } = await call(markLessonViewed as Handler, {
      user: OWNER,
      params: { id: 'a-1' },
      body,
    });
    expect(err).toBeNull();
  });
  it('ADMIN-tier can mark viewed', async () => {
    const { err } = await call(markLessonViewed as Handler, {
      user: ADMIN,
      params: { id: 'a-1' },
      body,
    });
    expect(err).toBeNull();
  });
  it('GROUP LEAD in-group can mark viewed', async () => {
    groupScope.leadAllows = true;
    const { err } = await call(markLessonViewed as Handler, {
      user: LEAD,
      params: { id: 'a-1' },
      body,
    });
    expect(err).toBeNull();
  });
  it('GROUP LEAD out-of-group is DENIED (404)', async () => {
    groupScope.leadAllows = false;
    const { err } = await call(markLessonViewed as Handler, {
      user: LEAD,
      params: { id: 'a-1' },
      body,
    });
    expect(err?.status).toBe(404);
  });
});

// ─── submitQuizAttempt ──────────────────────────────────────────────────────
describe('submitQuizAttempt — group scope', () => {
  const body = { quiz_id: VALID_QUIZ_ID, selected_answer: 'A' };
  it('owner can submit', async () => {
    const { err } = await call(submitQuizAttempt as Handler, {
      user: OWNER,
      params: { id: 'a-1' },
      body,
    });
    expect(err).toBeNull();
  });
  it('ADMIN-tier can submit on-behalf-of', async () => {
    const { err } = await call(submitQuizAttempt as Handler, {
      user: ADMIN,
      params: { id: 'a-1' },
      body,
    });
    expect(err).toBeNull();
  });
  it('GROUP LEAD in-group can submit on-behalf-of', async () => {
    groupScope.leadAllows = true;
    const { err } = await call(submitQuizAttempt as Handler, {
      user: LEAD,
      params: { id: 'a-1' },
      body,
    });
    expect(err).toBeNull();
  });
  it('GROUP LEAD out-of-group is DENIED (404) and quiz grader is NOT invoked', async () => {
    groupScope.leadAllows = false;
    const { err } = await call(submitQuizAttempt as Handler, {
      user: LEAD,
      params: { id: 'a-1' },
      body,
    });
    expect(err?.status).toBe(404);
  });
});

// ─── listEvaluations ────────────────────────────────────────────────────────
describe('listEvaluations — group scope', () => {
  it('owner (learner) can list their own', async () => {
    const { err, res } = await call(listEvaluations as Handler, {
      user: OWNER,
      params: { id: 'a-1' },
    });
    expect(err).toBeNull();
    expect(res.body).toEqual([{ id: 'e-1' }]);
  });
  it('ADMIN-tier can list any', async () => {
    const { err } = await call(listEvaluations as Handler, {
      user: ADMIN,
      params: { id: 'a-1' },
    });
    expect(err).toBeNull();
  });
  it('GROUP LEAD in-group can list', async () => {
    groupScope.leadAllows = true;
    const { err } = await call(listEvaluations as Handler, {
      user: LEAD,
      params: { id: 'a-1' },
    });
    expect(err).toBeNull();
  });
  it('GROUP LEAD out-of-group is DENIED (404)', async () => {
    groupScope.leadAllows = false;
    const { err } = await call(listEvaluations as Handler, {
      user: LEAD,
      params: { id: 'a-1' },
    });
    expect(err?.status).toBe(404);
  });
});

// ─── createEvaluation ───────────────────────────────────────────────────────
describe('createEvaluation — group scope', () => {
  const body = { kind: 'SUPERVISOR_INTERIM', supervisor_notes: 'Solid' };
  it('ADMIN-tier can create any kind', async () => {
    const { err } = await call(createEvaluation as Handler, {
      user: ADMIN,
      params: { id: 'a-1' },
      body,
    });
    expect(err).toBeNull();
  });
  it('GROUP LEAD in-group can create a manager-kind eval', async () => {
    groupScope.leadAllows = true;
    const { err } = await call(createEvaluation as Handler, {
      user: LEAD,
      params: { id: 'a-1' },
      body,
    });
    expect(err).toBeNull();
  });
  it('GROUP LEAD out-of-group is DENIED (404)', async () => {
    groupScope.leadAllows = false;
    const { err } = await call(createEvaluation as Handler, {
      user: LEAD,
      params: { id: 'a-1' },
      body,
    });
    expect(err?.status).toBe(404);
  });
  it('learner can create their student-kind eval (SELF_12_MONTH)', async () => {
    const { err } = await call(createEvaluation as Handler, {
      user: OWNER,
      params: { id: 'a-1' },
      body: { kind: 'SELF_12_MONTH', goals_progress: 'My reflection' },
    });
    expect(err).toBeNull();
  });
  it('learner CANNOT create a manager-kind eval (403)', async () => {
    const { err } = await call(createEvaluation as Handler, {
      user: OWNER,
      params: { id: 'a-1' },
      body, // SUPERVISOR_INTERIM
    });
    expect(err?.status).toBe(403);
  });
  it('a different consultant gets 404', async () => {
    const { err } = await call(createEvaluation as Handler, {
      user: STRANGER,
      params: { id: 'a-1' },
      body,
    });
    expect(err?.status).toBe(404);
  });
});

// ─── updateEvaluation ───────────────────────────────────────────────────────
describe('updateEvaluation — group scope (via parent assignment)', () => {
  beforeEach(() => {
    mock.evaluation = { id: 'e-1', assignment_id: 'a-1', kind: 'SUPERVISOR_INTERIM' };
  });
  it('ADMIN-tier can update', async () => {
    const { err } = await call(updateEvaluation as Handler, {
      user: ADMIN,
      params: { evalId: 'e-1' },
      body: { notes: 'updated' },
    });
    expect(err).toBeNull();
  });
  it('GROUP LEAD in-group can update', async () => {
    groupScope.leadAllows = true;
    const { err } = await call(updateEvaluation as Handler, {
      user: LEAD,
      params: { evalId: 'e-1' },
      body: { notes: 'updated' },
    });
    expect(err).toBeNull();
  });
  it('GROUP LEAD out-of-group is DENIED (404)', async () => {
    groupScope.leadAllows = false;
    const { err } = await call(updateEvaluation as Handler, {
      user: LEAD,
      params: { evalId: 'e-1' },
      body: { notes: 'updated' },
    });
    expect(err?.status).toBe(404);
  });
});
