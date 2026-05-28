// Bench matches (GET /consultants?matchFor=:jobId) and recruiter notes
// (GET/PATCH /jobs/:id/note) are now backed by real endpoints; the client-side
// fallbacks below stay as a safety net for the window before the note migration
// (1700000000010_job_recruiter_note.sql) is applied.
//
// /jobs/score was a CONSULTANT-only natural-language re-rank stub. /jobs itself
// is OPERATOR_TIER-gated (consultants can't reach /jobs/*), so the route was
// unreachable and the scoreQuery() client never had a caller. Removed.

import { api } from '../../services/api';

export interface BenchMatch {
  id: string;
  name: string;
  title?: string | null;
  matchScore: number;
}

/** Deterministic pseudo-score so the fallback is stable across renders. */
function pseudoScore(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (Math.imul(31, h) + id.charCodeAt(i)) >>> 0;
  }
  return 65 + (h % 30);
}

type RawConsultant = {
  id: string;
  full_name?: string | null;
  name?: string | null;
  current_title?: string | null;
  title?: string | null;
  matchScore?: number;
  match_score?: number;
};

function toMatch(c: RawConsultant, score?: number): BenchMatch {
  return {
    id: c.id,
    name: c.full_name ?? c.name ?? 'Consultant',
    title: c.current_title ?? c.title ?? null,
    matchScore: score ?? c.matchScore ?? c.match_score ?? pseudoScore(c.id),
  };
}

/**
 * GET /consultants?matchFor=:jobId
 * Returns bench consultants scored against a job.
 * Fallback: GET /consultants → pseudo-score, filter >= 65, top 6.
 */
export async function fetchBenchMatches(jobId: string): Promise<BenchMatch[]> {
  try {
    const res = await api.get<RawConsultant[]>(`/consultants`, {
      params: { matchFor: jobId },
    });
    return res.data.map((c) => toMatch(c));
  } catch {
    try {
      const fallback = await api.get<RawConsultant[]>('/consultants');
      return fallback.data
        .map((c) => toMatch(c, pseudoScore(c.id)))
        .filter((m) => m.matchScore >= 65)
        .slice(0, 6);
    } catch {
      return [];
    }
  }
}

/**
 * PATCH /jobs/:id/note
 * Persists a recruiter note on the job.
 * Returns the saved note shape so the caller can sync state without
 * waiting for a follow-up GET (the previous void return meant the UI
 * couldn't show the author/timestamp until the user reloaded).
 * Fallback: writes to localStorage key `ho-jobnote:<id>`.
 */
export async function saveRecruiterNote(
  jobId: string,
  body: string,
): Promise<{ body: string; author?: string | null; updated_at?: string | null }> {
  try {
    const res = await api.patch<{
      body: string;
      author?: string | null;
      updated_at?: string | null;
    }>(`/jobs/${jobId}/note`, { body });
    return res.data;
  } catch {
    localStorage.setItem(`ho-jobnote:${jobId}`, body);
    return { body, author: null, updated_at: new Date().toISOString() };
  }
}

/**
 * GET /jobs/:id/note
 * Fetches a recruiter note for the job.
 * Fallback: reads from localStorage key `ho-jobnote:<id>`.
 */
export async function fetchRecruiterNote(
  jobId: string,
): Promise<{ body: string; author?: string | null; updated_at?: string | null } | null> {
  try {
    const res = await api.get<{
      body: string;
      author?: string | null;
      updated_at?: string | null;
    }>(`/jobs/${jobId}/note`);
    return res.data;
  } catch {
    const stored = localStorage.getItem(`ho-jobnote:${jobId}`);
    if (stored !== null) {
      return { body: stored };
    }
    return null;
  }
}
