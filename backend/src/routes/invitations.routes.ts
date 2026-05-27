import { Router } from 'express';
import { requireRoleOrCapability } from '../middleware/auth';
import { OPERATOR_TIER } from '../types';
import * as c from '../controllers/invitations.controller';

export const invitationsRouter = Router();

// OPERATOR_TIER so a RECRUITER can reach the invite surface; the controller's
// canAssignRole() ceiling then restricts a RECRUITER to inviting CONSULTANTs
// only. DEVELOPER passes via the `invitations` capability. The list/revoke
// handlers already scope non-admins to their own invitations.
const gate = requireRoleOrCapability(OPERATOR_TIER, 'invitations');

invitationsRouter.get('/', gate, c.list);
invitationsRouter.post('/', gate, c.create);
invitationsRouter.post('/accept', c.accept);
invitationsRouter.get('/available-parents', gate, c.availableParents);
invitationsRouter.post('/:id/revoke', gate, c.revoke);
