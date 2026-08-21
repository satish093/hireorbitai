import type { Request, Response } from 'express';
import { requiresUpdate, compareVersions, isValidVersion } from '@hireorbitai/shared';
import { env } from '../config/env';

/**
 * GET /app-version?platform=ios|android&version=1.2.3
 *
 * The store-update gate. Answers one question: may this build keep running?
 *
 * PUBLIC on purpose — mounted ahead of requireAuth. A client old enough to be
 * blocked may also be too old to complete the auth handshake, and telling that
 * user "update the app" is far better than a login screen that fails forever.
 *
 * Carries no user data and is cheap, so it is safe to leave unauthenticated.
 *
 * Reference: README "What still needs backend work" #2 (API versioning). This
 * is the client half of that mitigation — it lets a breaking API change be
 * paired with a floor, instead of silently breaking every un-updated phone.
 */
export function getAppVersion(req: Request, res: Response): void {
  const platform = String(req.query.platform ?? '').toLowerCase();
  if (platform !== 'ios' && platform !== 'android') {
    res.status(400).json({ error: "platform must be 'ios' or 'android'" });
    return;
  }

  const current = String(req.query.version ?? '').trim();
  const minimum = env.mobile.minVersion[platform];
  const latest = env.mobile.latestVersion[platform];

  // requiresUpdate() fails open on any unparseable input; a bad env value or a
  // garbled client version must never hard-block the whole install base.
  const updateRequired = requiresUpdate(current, minimum);

  // Advisory only — a newer build exists but this one still works.
  const updateAvailable =
    !updateRequired &&
    isValidVersion(current) &&
    isValidVersion(latest) &&
    compareVersions(current, latest) < 0;

  res.json({
    platform,
    currentVersion: current || null,
    minimumVersion: minimum || null,
    latestVersion: latest || null,
    updateRequired,
    updateAvailable,
    storeUrl: env.mobile.storeUrl[platform],
  });
}
