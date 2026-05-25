/**
 * Security + behaviour coverage for the inline AI learning coach
 * (POST /training/assignments/:id/coach).
 *
 * The coach is a learner route — ownership is enforced inside the handler, not
 * by a route-level role gate. A CONSULTANT may only coach on their OWN
 * assignment; a mismatch must return 404 (not an existence-oracle 403).
 * Manager-tier keeps on-behalf-of access. The answer is grounded in the
 * assignment's pinned lesson content, so an unknown lesson_id is a 404 and the
 * resolved lesson is what gets passed to the AI service. DB + service deps are
 * mocked so the controller imports without reaching config/env.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFlags = vi.hoisted(() => ({
  anthropicEnabled: true,
  assignmentOwner: 'u-consultant' as string | null,
}));

vi.mock('../config/db', () => ({ db: { from: () => ({}) }, pool: {} }));
vi.mock('../config/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../config/anthropic', () => ({
  get ANTHROPIC_ENABLED() {
    return mockFlags.anthropicEnabled;
  },
}));

const lessonCoachMock = vi.hoisted(() => vi.fn(async () => 'A grounded answer.'));
vi.mock('../services/ai.service', () => ({ lessonCoach: lessonCoachMock }));

vi.mock('../repositories/training.repository', () => ({
  assignments: {
    get: vi.fn(async () =>
      mockFlags.assignmentOwner === null
        ? { data: null, error: null }
        : {
            data: {
              id: 'a-1',
              course_id: 'c-1',
              assigned_to_user_id: mockFlags.assignmentOwner,
            },
            error: null,
          },
    ),
  },
}));

vi.mock('../services/training.service', () => ({
  resolveAssignmentContent: vi.fn(async () => ({
    course: { title: 'Intro to Security' },
    lessons: [
      {
        id: '11111111-1111-1111-1111-111111111111',
        title: 'CIA Triad',
        description: 'Confidentiality, integrity, availability',
        content: 'The CIA triad is...',
        practical_example: null,
        key_takeaways: ['Confidentiality', 'Integrity', 'Availability'],
      },
    ],
    quizzes: [],
    versioned: true,
  })),
}));

vi.mock('../services/trainingAchievements.service', () => ({
  evaluateAchievements: vi.fn(),
  logStudyMinutes: vi.fn(),
}));
vi.mock('../services/realtime.service', () => ({ publishToUser: vi.fn() }));

import { lessonCoach } from './training.controller';

const KNOWN_LESSON = '11111111-1111-1111-1111-111111111111';
const OTHER_LESSON = '22222222-2222-2222-2222-222222222222';
const CONSULTANT = { id: 'u-consultant', role: 'CONSULTANT' };
const OTHER_CONSULTANT = { id: 'u-other', role: 'CONSULTANT' };
const MANAGER = { id: 'u-manager', role: 'MANAGER' };

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

async function call(req: {
  body?: any;
  params?: any;
  user?: any;
}): Promise<{ res: any; err: { status?: number } | null }> {
  const res = mkRes();
  try {
    await lessonCoach(
      { body: {}, params: { id: 'a-1' }, log: { warn: vi.fn() }, ...req } as any,
      res,
      vi.fn(),
    );
    return { res, err: null };
  } catch (e) {
    return { res, err: e as { status?: number } };
  }
}

beforeEach(() => {
  mockFlags.anthropicEnabled = true;
  mockFlags.assignmentOwner = 'u-consultant';
  lessonCoachMock.mockClear();
  lessonCoachMock.mockResolvedValue('A grounded answer.');
});

describe('lessonCoach — ownership + grounding', () => {
  it('returns an answer for the assignment owner and passes the resolved lesson', async () => {
    const { err, res } = await call({
      body: { question: 'What is the CIA triad?', lesson_id: KNOWN_LESSON },
      user: CONSULTANT,
    });
    expect(err).toBeNull();
    expect(res.body).toEqual({ answer: 'A grounded answer.' });
    expect(lessonCoachMock).toHaveBeenCalledTimes(1);
    const arg = (lessonCoachMock.mock.calls as any[])[0][0];
    expect(arg.lesson.title).toBe('CIA Triad');
    expect(arg.courseTitle).toBe('Intro to Security');
  });

  it('404s when a non-owner consultant coaches another assignment', async () => {
    const { err } = await call({
      body: { question: 'Explain this', lesson_id: KNOWN_LESSON },
      user: OTHER_CONSULTANT,
    });
    expect(err?.status).toBe(404);
    expect(lessonCoachMock).not.toHaveBeenCalled();
  });

  it('allows manager-tier on-behalf-of access', async () => {
    const { err, res } = await call({
      body: { question: 'Explain this', lesson_id: KNOWN_LESSON },
      user: MANAGER,
    });
    expect(err).toBeNull();
    expect(res.body).toEqual({ answer: 'A grounded answer.' });
  });

  it('404s for a lesson_id that is not in the pinned content', async () => {
    const { err } = await call({
      body: { question: 'Explain this', lesson_id: OTHER_LESSON },
      user: CONSULTANT,
    });
    expect(err?.status).toBe(404);
    expect(lessonCoachMock).not.toHaveBeenCalled();
  });
});

describe('lessonCoach — input + config guards', () => {
  it('400s on an empty question', async () => {
    const { err } = await call({
      body: { question: '   ', lesson_id: KNOWN_LESSON },
      user: CONSULTANT,
    });
    expect(err?.status).toBe(400);
  });

  it('400s on an unexpected extra field (.strict())', async () => {
    const { err } = await call({
      body: { question: 'Hi', lesson_id: KNOWN_LESSON, role: 'SUPER_ADMIN' },
      user: CONSULTANT,
    });
    expect(err?.status).toBe(400);
  });

  it('503s when AI is not configured', async () => {
    mockFlags.anthropicEnabled = false;
    const { err } = await call({
      body: { question: 'Hi', lesson_id: KNOWN_LESSON },
      user: CONSULTANT,
    });
    expect(err?.status).toBe(503);
  });
});
