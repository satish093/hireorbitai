import { Router } from 'express';
import { requireRole } from '../middleware/auth';
import { MANAGER_TIER } from '../types';
import * as c from '../controllers/invitations.controller';

export const invitationsRouter = Router();

invitationsRouter.get('/', requireRole(...MANAGER_TIER), c.list);
invitationsRouter.post('/', requireRole(...MANAGER_TIER), c.create);
invitationsRouter.post('/accept', c.accept);
invitationsRouter.post('/:id/revoke', requireRole(...MANAGER_TIER), c.revoke);
