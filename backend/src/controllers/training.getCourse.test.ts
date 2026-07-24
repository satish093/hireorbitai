/**
 * Regression test for the training.getCourse answer-key leak (audit HIGH).
 * GET /training/courses/:id has no route role gate and the repo embeds raw
 * training_quizzes rows including correct_answer/explanation. getCourse now
 * strips those for non-manager callers (students) and keeps them for
 * manager-tier callers (course authors who must edit the key).
 */

import { describe, it, expect, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  course: {
    id: 'course-1',
    title: 'Compliance 101',
    lessons: [{ id: 'l-1', title: 'Intro' }],
    quizzes: [
      {
        id: 'q-1',
        prompt: 'Pick A',
        options: ['A', 'B'],
        correct_answer: 'A',
        explanation: 'Because A',
      },
    ],
  } as Record<string, unknown>,
}));

vi.mock('../repositories/training.repository', () => ({
  courses: { get: vi.fn().mockImplementation(async () => ({ data: mock.course, error: null })) },
}));
// Heavy sibling imports — stub so importing the controller never reaches config/env.
vi.mock('../config/db', () => ({
  db: {
    from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) }),
  },
  pool: {},
}));
vi.mock('../services/groupScope', () => ({
  managerGroupUserIds: vi.fn(() => Promise.resolve([])),
  leadCanAccessUser: vi.fn(() => Promise.resolve(true)),
  isGroupLead: () => false,
  isAdminTier: () => true,
}));
vi.mock('../config/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../services/training.service', () => ({}));
vi.mock('../services/trainingAI.service', () => ({}));
vi.mock('../services/ai.service', () => ({ lessonCoach: vi.fn() }));
vi.mock('../config/anthropic', () => ({ ANTHROPIC_ENABLED: true }));
vi.mock('../services/trainingAchievements.service', () => ({
  evaluateAchievements: vi.fn(),
  logStudyMinutes: vi.fn(),
}));
vi.mock('../services/realtime.service', () => ({
  publishToUser: vi.fn(() => Promise.resolve()),
}));

import { getCourse } from './training.controller';

function mkRes() {
  const res: any = {
    body: undefined as any,
    json(b: unknown) {
      this.body = b;
      return this;
    },
    status() {
      return this;
    },
  };
  return res;
}

async function call(role: string) {
  // Deep-clone the fixture per call so one test's strip doesn't mutate the next.
  mock.course = JSON.parse(
    JSON.stringify({
      id: 'course-1',
      title: 'Compliance 101',
      lessons: [{ id: 'l-1', title: 'Intro' }],
      quizzes: [
        {
          id: 'q-1',
          prompt: 'Pick A',
          options: ['A', 'B'],
          correct_answer: 'A',
          explanation: 'Because A',
        },
      ],
    }),
  );
  const res = mkRes();
  await (getCourse as any)({ params: { id: 'course-1' }, user: { id: 'u', role } }, res, vi.fn());
  return res.body as { quizzes: Record<string, unknown>[] };
}

describe('training.getCourse — quiz answer-key guard', () => {
  it('strips correct_answer/explanation for a CONSULTANT (student)', async () => {
    const body = await call('CONSULTANT');
    expect(body.quizzes[0]).not.toHaveProperty('correct_answer');
    expect(body.quizzes[0]).not.toHaveProperty('explanation');
    // Non-secret fields survive so the catalog can still render the quiz shell.
    expect(body.quizzes[0]).toMatchObject({ id: 'q-1', prompt: 'Pick A' });
  });

  it('strips for a RECRUITER too (non-manager)', async () => {
    const body = await call('RECRUITER');
    expect(body.quizzes[0]).not.toHaveProperty('correct_answer');
  });

  it('keeps the answer key for a manager-tier author (MANAGER)', async () => {
    const body = await call('HR_MANAGER');
    expect(body.quizzes[0]).toHaveProperty('correct_answer', 'A');
    expect(body.quizzes[0]).toHaveProperty('explanation', 'Because A');
  });
});
