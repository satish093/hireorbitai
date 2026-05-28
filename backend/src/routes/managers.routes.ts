import { Router } from 'express';
import { requireRole } from '../middleware/auth';
import { ADMIN_TIER, MANAGER_TIER } from '../types';
import * as c from '../controllers/managers.controller';

export const managersRouter = Router();

// Readable by all MANAGER_TIER (group leads see their own group, admin sees all).
managersRouter.get('/', requireRole(...MANAGER_TIER), c.list);
managersRouter.post('/:id/move-group', requireRole(...ADMIN_TIER), c.moveGroup);
