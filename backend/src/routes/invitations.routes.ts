import { Router } from 'express';
import { requireRoleOrCapability } from '../middleware/auth';
import { MANAGER_TIER } from '../types';
import * as c from '../controllers/invitations.controller';

export const invitationsRouter = Router();

const gate = requireRoleOrCapability(MANAGER_TIER, 'invitations');

invitationsRouter.get('/', gate, c.list);
invitationsRouter.post('/', gate, c.create);
invitationsRouter.post('/accept', c.accept);
invitationsRouter.get('/available-parents', gate, c.availableParents);
invitationsRouter.post('/:id/revoke', gate, c.revoke);
