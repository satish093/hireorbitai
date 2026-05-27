import { Router } from 'express';
import { requireRoleOrCapability } from '../middleware/auth';
import { OWNER_TIER, ADMIN_TIER } from '../types';
import * as c from '../controllers/featureFlags.controller';

export const featureFlagsRouter = Router();

// `/me` is the per-user "what can I see" lookup — every page needs it, so it
// stays open to any authenticated user. The full flag list + per-group
// overrides expose workspace configuration/structure, so they are admin-tier
// (or a DEVELOPER granted `feature_flags`) only.
featureFlagsRouter.get('/me', c.myFlags);
featureFlagsRouter.get('/', requireRoleOrCapability(ADMIN_TIER, 'feature_flags'), c.list);
featureFlagsRouter.get(
  '/overrides',
  requireRoleOrCapability(ADMIN_TIER, 'feature_flags'),
  c.listOverrides,
);
// Only workspace owners (SUPER_ADMIN / CEO) can flip flags.
featureFlagsRouter.patch('/:key', requireRoleOrCapability(OWNER_TIER, 'feature_flags'), c.setFlag);
featureFlagsRouter.put(
  '/groups/:groupId/:key',
  requireRoleOrCapability(OWNER_TIER, 'feature_flags'),
  c.setGroupOverride,
);
