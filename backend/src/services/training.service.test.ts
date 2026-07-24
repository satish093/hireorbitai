/**
 * Unit tests for the Training versioning core. The repository + db + AI layers
 * are mocked so the suite runs without Postgres or env validation (mocking
 * `config/db` short-circuits the env fail-fast, same trick as the permission
 * suite).
 *
 * Covers the load-bearing invariant of snapshot-on-publish: an assignment
 * pinned to a version reads that frozen snapshot and IGNORES later live edits,
 * while a legacy (unversioned) assignment falls back to live tables. Plus the
 * student-facing answer-key stripping.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  courseVersionsGet: vi.fn(),
  coursesGet: vi.fn(),
  lessonsList: vi.fn(),
  quizzesList: vi.fn(),
}));

// Mock the modules training.service imports at top level so the real
// config/env (process.exit on missing vars) never runs.
vi.mock('../config/db', () => ({ db: {} }));
vi.mock('./trainingAI.service', () => ({}));
vi.mock('../repositories/training.repository', () => ({
  courseVersions: { get: mock.courseVersionsGet },
  courses: { get: mock.coursesGet },
  lessons: { listByCourse: mock.lessonsList },
  quizzes: { listByCourse: mock.quizzesList },
}));

import { resolveAssignmentContent, stripQuizAnswers } from './training.service';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('stripQuizAnswers', () => {
  it('removes correct_answer + explanation from lesson and course quizzes but keeps the rest', () => {
    const out = stripQuizAnswers({
      course: { title: 'C' },
      lessons: [
        {
          id: 'L1',
          title: 'Lesson',
          quiz: [
            {
              id: 'q1',
              question: 'Q?',
              options: ['a', 'b'],
              correct_answer: 'a',
              explanation: 'because',
            },
          ],
        },
      ],
      quizzes: [
        {
          id: 'q1',
          question: 'Q?',
          options: ['a', 'b'],
          correct_answer: 'a',
          explanation: 'because',
        },
      ],
    });

    const lq = out.lessons[0].quiz[0];
    expect(lq).not.toHaveProperty('correct_answer');
    expect(lq).not.toHaveProperty('explanation');
    expect(lq.question).toBe('Q?');
    expect(lq.options).toEqual(['a', 'b']);

    expect(out.quizzes[0]).not.toHaveProperty('correct_answer');
    expect(out.quizzes[0]).not.toHaveProperty('explanation');
  });
});

describe('resolveAssignmentContent — version isolation', () => {
  it('reads the pinned snapshot and ignores later live edits', async () => {
    mock.courseVersionsGet.mockResolvedValue({
      data: {
        snapshot: {
          course: { title: 'Frozen v1' },
          lessons: [{ id: 'L1', title: 'v1 lesson' }],
          quizzes: [{ id: 'q1', correct_answer: 'a' }],
        },
      },
    });
    // Live tables have since been edited — must NOT leak through.
    mock.coursesGet.mockResolvedValue({ data: { title: 'EDITED LIVE' } });
    mock.lessonsList.mockResolvedValue({ data: [{ id: 'L2', title: 'edited lesson' }] });

    const res = await resolveAssignmentContent({ course_version_id: 'v1', course_id: 'c1' });

    expect(res.versioned).toBe(true);
    expect(res.course.title).toBe('Frozen v1');
    expect(res.lessons).toHaveLength(1);
    expect(res.lessons[0].id).toBe('L1');
    // Live tables were never consulted for a versioned assignment.
    expect(mock.coursesGet).not.toHaveBeenCalled();
    expect(mock.lessonsList).not.toHaveBeenCalled();
  });

  it('falls back to live tables for a legacy (unversioned) assignment', async () => {
    mock.coursesGet.mockResolvedValue({ data: { title: 'LIVE' } });
    mock.lessonsList.mockResolvedValue({ data: [{ id: 'L9' }] });
    mock.quizzesList.mockResolvedValue({ data: [{ id: 'q9', correct_answer: 'b' }] });

    const res = await resolveAssignmentContent({ course_version_id: null, course_id: 'c1' });

    expect(res.versioned).toBe(false);
    expect(res.course.title).toBe('LIVE');
    expect(res.lessons[0].id).toBe('L9');
    expect(mock.courseVersionsGet).not.toHaveBeenCalled();
  });

  it('falls back to live tables when the pinned version row is missing', async () => {
    mock.courseVersionsGet.mockResolvedValue({ data: null });
    mock.coursesGet.mockResolvedValue({ data: { title: 'LIVE' } });
    mock.lessonsList.mockResolvedValue({ data: [] });
    mock.quizzesList.mockResolvedValue({ data: [] });

    const res = await resolveAssignmentContent({ course_version_id: 'gone', course_id: 'c1' });

    expect(res.versioned).toBe(false);
    expect(res.course.title).toBe('LIVE');
  });
});
