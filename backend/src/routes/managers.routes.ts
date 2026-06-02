import { Router } from 'express';
import { requireRole } from '../middleware/auth';
import { ADMIN_TIER, MANAGER_TIER } from '../types';
import * as c from '../controllers/managers.controller';

export const managersRouter = Router();

// Readable by all MANAGER_TIER (group leads see their own group, admin sees all).
managersRouter.get('/', requireRole(...MANAGER_TIER), c.list);
managersRouter.post('/:id/move-group', requireRole(...ADMIN_TIER), c.moveGroup);

// Cross-group co-management grants — admin-tier only (a director grants a lead
// co-management of another group). The controller re-checks isAdminTier.
managersRouter.get('/:id/grants', requireRole(...ADMIN_TIER), c.listGrants);
managersRouter.post('/:id/grants', requireRole(...ADMIN_TIER), c.addGrant);
managersRouter.delete('/:id/grants/:groupId', requireRole(...ADMIN_TIER), c.removeGrant);
