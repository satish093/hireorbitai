import { Router } from 'express';
import { requireRole } from '../middleware/auth';
import { OPERATOR_TIER, MANAGER_TIER } from '../types';
import * as c from '../controllers/clients.controller';

export const clientsRouter = Router();

clientsRouter.get('/', c.list);
clientsRouter.get('/:id', c.get);
clientsRouter.post('/', requireRole(...OPERATOR_TIER), c.create);
clientsRouter.patch('/:id', requireRole(...OPERATOR_TIER), c.update);
clientsRouter.delete('/:id', requireRole(...MANAGER_TIER), c.remove);
