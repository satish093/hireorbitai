/**
 * jobs.enrichOne — "AI on open" enrichment.
 *
 * The detail page / preview drawer calls POST /jobs/:id/enrich when a job is
 * opened. It must use the AI extractor (not the bulk heuristic) and stamp the
 * stored requirements with an `_ai` sentinel so the UI doesn't re-run the model
 * on every reopen. DB + AI are mocked so the controller imports without env.
 */
import { describe, it, expect, vi } from 'vitest';

const captured = vi.hoisted(() => ({ patch: null as Record<string, any> | null }));

vi.mock('../config/db', () => {
  function builder() {
    const b: Record<string, unknown> = {};
    Object.assign(b, {
      select: () => b,
      eq: () => b,
      single: () =>
        Promise.resolve({
          data: {
            id: 'j-1',
            title: 'Senior Engineer',
            description: 'We use React and Node.',
            required_skills: [],
            location: 'Remote',
          },
          error: null,
        }),
      update: (p: Record<string, any>) => {
        captured.patch = p;
        return b;
      },
    });
    return b;
  }
  return { db: { from: () => builder() }, pool: {} };
});
vi.mock('../config/anthropic', () => ({ ANTHROPIC_ENABLED: true, AI_AVAILABLE: true }));

const aiMocks = vi.hoisted(() => ({
  extractJobRequirements: vi.fn(async () => ({
    must_haves: [],
    nice_to_haves: [],
    required_skills: ['React', 'Node.js'],
    min_years_of_experience: 5,
    job_seniority: 'Senior',
    work_model: 'Remote',
    work_authorization: [],
    location_requirements: null,
    core_responsibilities: [],
    skill_summaries: [],
    benefits_summaries: [],
    education_summaries: [],
    highlights: ['Modern stack'],
    recommendation_tags: ['Fully Remote'],
  })),
}));
vi.mock('../services/ai.service', () => ({
  matchJobsForConsultant: vi.fn(),
  atsScore: vi.fn(),
  scoreResumeAgainstJob: vi.fn(),
  jobCopilot: vi.fn(),
  generateCoverLetter: vi.fn(),
  extractJobRequirements: aiMocks.extractJobRequirements,
}));
vi.mock('../services/jobParser.service', () => ({ parseJobRequirements: vi.fn() }));
vi.mock('./resumes.controller', () => ({ tailorForJob: vi.fn() }));
vi.mock('./applications.controller', () => ({ fromJob: vi.fn() }));

import { enrichOne } from './jobs.controller';

function mkRes() {
  const res: any = {
    body: undefined,
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

describe('jobs.enrichOne — AI on open', () => {
  it('uses the AI extractor and marks stored requirements with _ai', async () => {
    const res = mkRes();
    await enrichOne(
      { params: { id: 'j-1' }, user: { id: 'u1', role: 'RECRUITER' } } as any,
      res,
      vi.fn(),
    );
    expect(aiMocks.extractJobRequirements).toHaveBeenCalledTimes(1);
    expect(captured.patch?.requirements._ai).toBe(true);
    expect(captured.patch?.requirements.required_skills).toEqual(['React', 'Node.js']);
    // The canonical column + level are mirrored from the AI result.
    expect(captured.patch?.required_skills).toEqual(['React', 'Node.js']);
    expect(captured.patch?.level).toBe('Senior');
  });
});
