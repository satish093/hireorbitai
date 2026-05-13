import { Router } from 'express';
import { requireRole } from '../middleware/auth';
import { MANAGER_TIER, OPERATOR_TIER, ALL_ROLES } from '../types';
import * as c from '../controllers/consultants.controller';

export const consultantsRouter = Router();

consultantsRouter.get('/', c.list);
consultantsRouter.get('/:id', c.get);
consultantsRouter.post('/onboard', c.onboard);
consultantsRouter.patch('/:id', requireRole(...ALL_ROLES), c.update);
consultantsRouter.post('/:id/assign-recruiter', requireRole(...MANAGER_TIER), c.assignRecruiter);
consultantsRouter.post('/:id/marketing-status', requireRole(...OPERATOR_TIER), c.setMarketingStatus);
