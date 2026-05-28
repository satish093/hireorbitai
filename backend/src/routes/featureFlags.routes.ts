import { Router } from 'express';
import { requireRole, requireRoleOrCapability } from '../middleware/auth';
import { OWNER_TIER, ADMIN_TIER } from '../types';
import * as c from '../controllers/featureFlags.controller';

export const featureFlagsRouter = Router();

// `/me` is the per-user "what can I see" lookup — every page needs it, so
// it stays open to any authenticated user.
//
// READS (list + per-group overrides) are admin-tier OR a DEVELOPER granted
// `feature_flags`. CTO + Director may inspect flag state but not toggle.
//
// WRITES are OWNER_TIER ONLY (SUPER_ADMIN + CEO) — `requireRole` here, NOT
// `requireRoleOrCapability`, so even a DEVELOPER with `feature_flags` can't
// flip a flag. The capability grants visibility only, never authority.
featureFlagsRouter.get('/me', c.myFlags);
featureFlagsRouter.get('/', requireRoleOrCapability(ADMIN_TIER, 'feature_flags'), c.list);
featureFlagsRouter.get(
  '/overrides',
  requireRoleOrCapability(ADMIN_TIER, 'feature_flags'),
  c.listOverrides,
);
featureFlagsRouter.patch('/:key', requireRole(...OWNER_TIER), c.setFlag);
featureFlagsRouter.put('/groups/:groupId/:key', requireRole(...OWNER_TIER), c.setGroupOverride);
