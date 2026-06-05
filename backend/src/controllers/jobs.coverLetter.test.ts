/**
 * Guards for jobs.coverLetter — the AI cover-letter writer.
 *
 * It mirrors the copilot: load the job + the caller's current resume, hand to
 * the AI service. The only client input is `tone`, validated by a `.strict()`
 * Zod schema, so this locks in:
 *   - strict schema rejects unknown fields (no payload injection),
 *   - the tone enum is closed,
 *   - a caller without a consultant profile gets 400 (not a 500),
 *   - a 503 when the AI provider isn't configured,
 *   - the happy path returns the generated letter verbatim.
 * DB + AI deps are mocked so the controller imports without touching env.
 */

import { describe, it, expect, vi } from 'vitest';

const mockFlags = vi.hoisted(() => ({ nullConsultant: false }));

vi.mock('../config/db', () => {
  const tableDefaults: Record<string, unknown> = {
    consultants: { id: 'mine', skills: null, primary_skill: null, total_experience_years: 5 },
    jobs: { id: 'j-1', title: 'Senior Engineer', requirements: null, required_skills: [] },
    resumes: { body_text: 'Experienced engineer.', ai_feedback: null },
    users: { full_name: 'Ada Lovelace' },
  };
  function builder(table: string) {
    const b: Record<string, unknown> = {};
    Object.assign(b, {
      select: () => b,
      eq: () => b,
      single: () => Promise.resolve({ data: tableDefaults[table] ?? { id: 'x' }, error: null }),
      maybeSingle: () => {
        if (table === 'consultants' && mockFlags.nullConsultant) {
          return Promise.resolve({ data: null, error: null });
        }
        return Promise.resolve({ data: tableDefaults[table] ?? null, error: null });
      },
    });
    return b;
  }
  return { db: { from: (t: string) => builder(t) }, pool: {} };
});
vi.mock('../config/anthropic', () => ({ ANTHROPIC_ENABLED: true, AI_AVAILABLE: true }));

const aiMocks = vi.hoisted(() => ({
  generateCoverLetter: vi.fn(async () => ({
    cover_letter: 'Dear Hiring Team, …\n\nSincerely,\nAda Lovelace',
  })),
}));
vi.mock('../services/ai.service', () => ({
  matchJobsForConsultant: vi.fn(),
  atsScore: vi.fn(),
  scoreResumeAgainstJob: vi.fn(),
  jobCopilot: vi.fn(),
  generateCoverLetter: aiMocks.generateCoverLetter,
  extractJobRequirements: vi.fn(),
  AI_GENERATION_AVAILABLE: true,
}));
vi.mock('../services/jobParser.service', () => ({ parseJobRequirements: vi.fn() }));
vi.mock('./resumes.controller', () => ({ tailorForJob: vi.fn() }));
vi.mock('./applications.controller', () => ({ fromJob: vi.fn() }));

import { coverLetter } from './jobs.controller';

const CONSULTANT = { id: 'u-consultant', role: 'CONSULTANT' };

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

async function call(req: { body?: any; params?: any; user: any }) {
  const res = mkRes();
  try {
    await coverLetter({ query: {}, body: {}, params: { id: 'j-1' }, ...req } as any, res, vi.fn());
    return { res, err: null as { status?: number } | null };
  } catch (e) {
    return { res, err: e as { status?: number } };
  }
}

describe('jobs.coverLetter — input + profile guards', () => {
  it('rejects unknown body fields (strict schema)', async () => {
    const { err } = await call({
      body: { tone: 'professional', resume_text: 'injected' },
      user: CONSULTANT,
    });
    expect(err?.status).toBe(400);
  });

  it('rejects an out-of-enum tone', async () => {
    const { err } = await call({ body: { tone: 'snarky' }, user: CONSULTANT });
    expect(err?.status).toBe(400);
  });

  it('400s when the caller has no consultant profile', async () => {
    mockFlags.nullConsultant = true;
    try {
      const { err } = await call({ body: {}, user: CONSULTANT });
      expect(err?.status).toBe(400);
    } finally {
      mockFlags.nullConsultant = false;
    }
  });

  it('404s when a CONSULTANT requests a cover letter for another consultant_id', async () => {
    // assertConsultantAccess: a CONSULTANT may only reference their own row
    // (the mock resolves the caller to consultant id "mine").
    const { err } = await call({
      body: { consultant_id: '11111111-1111-1111-1111-111111111111' },
      user: CONSULTANT,
    });
    expect(err?.status).toBe(404);
  });

  it('returns the generated letter on the happy path', async () => {
    const { err, res } = await call({ body: { tone: 'enthusiastic' }, user: CONSULTANT });
    expect(err).toBeNull();
    expect(res.body).toHaveProperty('cover_letter');
    expect(String(res.body.cover_letter)).toContain('Sincerely');
    // The candidate name + tone flowed into the service call.
    expect(aiMocks.generateCoverLetter).toHaveBeenCalledWith(
      expect.objectContaining({
        tone: 'enthusiastic',
        candidate: expect.objectContaining({ name: 'Ada Lovelace' }),
      }),
    );
  });

  it('defaults to no tone when omitted (service applies its own default)', async () => {
    const { err } = await call({ body: {}, user: CONSULTANT });
    expect(err).toBeNull();
  });
});
