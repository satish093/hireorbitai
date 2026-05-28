import { Router } from 'express';
import { requireRole } from '../middleware/auth';
import { MANAGER_TIER } from '../types';
import * as c from '../controllers/recruiters.controller';

export const recruitersRouter = Router();

// Recruiter directory is a management view — MANAGER_TIER and above (matches the
// frontend, which hides /recruiters from a RECRUITER). Group leads are further
// confined to their group inside the controller; admin tier is unscoped.
recruitersRouter.get('/', requireRole(...MANAGER_TIER), c.list);
recruitersRouter.get('/:id', requireRole(...MANAGER_TIER), c.get);
// Recruiters onboard themselves; gate to the RECRUITER role only.
recruitersRouter.post('/onboard', requireRole('RECRUITER'), c.onboard);

// Many-to-many manager assignments — manager-tier and above can re-org.
recruitersRouter.post('/:id/managers', requireRole(...MANAGER_TIER), c.addManager);
recruitersRouter.delete('/:id/managers/:managerId', requireRole(...MANAGER_TIER), c.removeManager);
recruitersRouter.post(
  '/:id/managers/:managerId/primary',
  requireRole(...MANAGER_TIER),
  c.setPrimaryManager,
);
recruitersRouter.post('/:id/move-group', requireRole(...MANAGER_TIER), c.moveGroup);
