import { Router } from 'express';
import { requireRole } from '../middleware/auth';
import { OWNER_TIER } from '../types';
import * as c from '../controllers/featureFlags.controller';

export const featureFlagsRouter = Router();

featureFlagsRouter.get('/', c.list);
featureFlagsRouter.get('/me', c.myFlags);
featureFlagsRouter.get('/overrides', c.listOverrides);
// Only workspace owners (SUPER_ADMIN / CEO) can flip flags.
featureFlagsRouter.patch('/:key', requireRole(...OWNER_TIER), c.setFlag);
featureFlagsRouter.put('/groups/:groupId/:key', requireRole(...OWNER_TIER), c.setGroupOverride);
