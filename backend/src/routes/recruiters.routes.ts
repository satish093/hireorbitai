import { Router } from 'express';
import { requireRole } from '../middleware/auth';
import { MANAGER_TIER } from '../types';
import * as c from '../controllers/recruiters.controller';

export const recruitersRouter = Router();

recruitersRouter.get('/', c.list);
recruitersRouter.get('/:id', c.get);
recruitersRouter.post('/onboard', c.onboard);

// Many-to-many manager assignments — manager-tier and above can re-org.
recruitersRouter.post('/:id/managers', requireRole(...MANAGER_TIER), c.addManager);
recruitersRouter.delete('/:id/managers/:managerId', requireRole(...MANAGER_TIER), c.removeManager);
recruitersRouter.post(
  '/:id/managers/:managerId/primary',
  requireRole(...MANAGER_TIER),
  c.setPrimaryManager,
);
