import { RequestHandler } from 'express';
import { effectiveFlagsForUser } from '../controllers/featureFlags.controller';
import { httpError } from '../types';

/**
 * Block a route group when the named feature flag is OFF for the calling
 * user (after merging global flags with their group_id override).
 *
 * Default semantics: if the flag is missing from the DB entirely, the route
 * is allowed through. Same default as the frontend `useFeatureFlag` —
 * features that haven't been provisioned yet aren't accidentally hidden.
 *
 * Usage in routes/index.ts:
 *
 *   router.use('/tasks', requireFeature('tasks'), tasksRouter);
 *
 * Mount AFTER requireAuth so req.user.group_id is available.
 *
 * The middleware short-circuits with a clean 403 carrying the flag name in
 * `details` so the frontend can render "Tasks are turned off for your
 * workspace" instead of a generic forbidden error.
 */
export const requireFeature = (key: string): RequestHandler => async (req, _res, next) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const flags = await effectiveFlagsForUser(req.user.group_id ?? null);
  if (flags[key] === false) {
    throw httpError(403, `Feature "${key}" is disabled for your workspace.`, { feature: key });
  }
  next();
};
