import { Router } from 'express';
import { requireRoleOrCapability } from '../middleware/auth';
import { OWNER_TIER } from '../types';
import * as c from '../controllers/featureFlags.controller';

export const featureFlagsRouter = Router();

featureFlagsRouter.get('/', c.list);
featureFlagsRouter.get('/me', c.myFlags);
featureFlagsRouter.get('/overrides', c.listOverrides);
// Only workspace owners (SUPER_ADMIN / CEO) can flip flags.
featureFlagsRouter.patch('/:key', requireRoleOrCapability(OWNER_TIER, 'feature_flags'), c.setFlag);
featureFlagsRouter.put(
  '/groups/:groupId/:key',
  requireRoleOrCapability(OWNER_TIER, 'feature_flags'),
  c.setGroupOverride,
);
