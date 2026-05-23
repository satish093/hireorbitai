/**
 * In-process LRU cache for AI call results.
 *
 * Identical inputs (same resume text, same JD) produce identical AI outputs, so
 * there's no reason to pay for a second API call. This cache sits in front of
 * the expensive functions in ai.service.ts and trainingAI.service.ts.
 *
 * Cache instances are module-level singletons (one per Node process). They are
 * intentionally NOT shared across workers — each PM2 worker maintains its own
 * warm cache, which is fine because the cost of a cache miss is one API call
 * rather than a coordination round-trip.
 *
 * Key strategy: SHA-256 of the JSON-serialised input truncated to 16 hex chars.
 * Collisions are astronomically unlikely at this cache size.
 */

import { LRUCache } from 'lru-cache';
import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// Generic cache factory
// ---------------------------------------------------------------------------

// lru-cache v11 requires V extends {} (no null/undefined values stored directly).
function makeCache<V extends {}>(opts: { max: number; ttlMs: number }) {
  return new LRUCache<string, V>({
    max: opts.max,
    ttl: opts.ttlMs,
    allowStale: false,
  });
}

/** Stable string key from any JSON-serialisable value. */
export function cacheKey(input: unknown): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 16);
}

/**
 * Wrap an async function with cache-aside logic.
 *
 * The return type `V` is inferred from the callback `fn`, NOT from the cache
 * instance. All caches store `object`; the callers are responsible for the
 * specific subtype. The cast `hit as V` is safe because we only ever store a
 * `V` via `fn`.
 */
export async function withCache<V extends object>(
  cache: { get(k: string): unknown; set(k: string, v: object): void },
  keyData: unknown,
  fn: () => Promise<V>,
): Promise<V> {
  const k = cacheKey(keyData);
  const hit = cache.get(k);
  if (hit !== undefined) return hit as V;
  const result = await fn();
  cache.set(k, result);
  return result;
}

// ---------------------------------------------------------------------------
// Per-feature cache instances (TTLs tuned to how often the input changes)
// ---------------------------------------------------------------------------

/**
 * Resume quality score.
 * TTL 30 min — a user might tweak and re-upload, so don't cache too long.
 * Max 300 entries (each ~1 KB).
 */
export const resumeScoreCache = makeCache<object>({ max: 300, ttlMs: 30 * 60_000 });

/**
 * Parsed resume profile (name, skills, experience list…).
 * TTL 1 h — same text → same parse; uploads are infrequent.
 */
export const resumeProfileCache = makeCache<object>({ max: 300, ttlMs: 60 * 60_000 });

/**
 * Job requirements extraction.
 * TTL 24 h — job descriptions rarely change; cache aggressively.
 */
export const jobRequirementsCache = makeCache<object>({ max: 500, ttlMs: 24 * 60 * 60_000 });

/**
 * Per-skill resume-vs-job match result.
 * TTL 1 h — same resume + same JD → same score.
 */
export const skillMatchCache = makeCache<object>({ max: 500, ttlMs: 60 * 60_000 });

/**
 * ATS keyword match score.
 * TTL 1 h.
 */
export const atsScoreCache = makeCache<object>({ max: 500, ttlMs: 60 * 60_000 });

/**
 * Batch job-match scores for a consultant.
 * TTL 15 min — the job list changes often, so keep this short.
 * Stored as object (the full schema result); callers extract .matches.
 */
export const jobMatchCache = makeCache<object>({ max: 200, ttlMs: 15 * 60_000 });

// ---------------------------------------------------------------------------
// Training AI caches
// ---------------------------------------------------------------------------

/**
 * Training plan (resume + JD → skill gaps + roadmap).
 * TTL 1 h — resumes change, but not constantly.
 */
export const trainingPlanCache = makeCache<object>({ max: 200, ttlMs: 60 * 60_000 });

/**
 * Interview questions for a role/skill set.
 * TTL 24 h — JDs are stable; no need to regenerate every call.
 */
export const interviewQuestionsCache = makeCache<object>({ max: 200, ttlMs: 24 * 60 * 60_000 });

/**
 * Quiz questions generated from lesson content.
 * TTL 24 h — lesson text is stable after authoring.
 */
export const quizCache = makeCache<object>({ max: 300, ttlMs: 24 * 60 * 60_000 });
