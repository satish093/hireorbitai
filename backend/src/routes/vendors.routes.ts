import { Router } from 'express';
import { requireRole } from '../middleware/auth';
import { OPERATOR_TIER, MANAGER_TIER } from '../types';
import * as c from '../controllers/vendors.controller';

export const vendorsRouter = Router();

vendorsRouter.get('/', requireRole(...OPERATOR_TIER), c.list);
vendorsRouter.get('/:id', requireRole(...OPERATOR_TIER), c.get);
vendorsRouter.post('/', requireRole(...OPERATOR_TIER), c.create);
vendorsRouter.patch('/:id', requireRole(...OPERATOR_TIER), c.update);
vendorsRouter.delete('/:id', requireRole(...MANAGER_TIER), c.remove);
