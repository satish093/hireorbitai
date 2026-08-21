import type { Request, Response } from 'express';

/**
 * Shared 429 handler for every express-rate-limit limiter in the app.
 *
 * Emits a clean JSON body + a Retry-After header in seconds (the library's
 * default is a plain-text "Too many requests"). Extracted here so the limiters
 * in both server.ts and the per-route files (auth.routes.ts) return an
 * identical contract — clients read `retry_after_seconds` / Retry-After to back
 * off. Capped at 60s so a misconfigured client never sleeps for a full window.
 */
export function sendRateLimitResponse(
  _req: Request,
  res: Response,
  _next: unknown,
  opts: { windowMs: number },
): void {
  const resetSec = Number(res.getHeader('RateLimit-Reset'));
  const fallback = Math.ceil(opts.windowMs / 1000);
  const retryAfter = Math.min(60, Number.isFinite(resetSec) && resetSec > 0 ? resetSec : fallback);
  res.setHeader('Retry-After', String(retryAfter));
  res.status(429).json({
    error: 'Too many requests. Please slow down.',
    retry_after_seconds: retryAfter,
  });
}
