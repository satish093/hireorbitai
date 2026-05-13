import { Router } from 'express';
import { requireRole } from '../middleware/auth';
import { MANAGER_TIER } from '../types';
import * as c from '../controllers/userGroups.controller';

export const userGroupsRouter = Router();

// Everyone authenticated can read the list (used by selectors).
userGroupsRouter.get('/diag', c.diag);
userGroupsRouter.get('/', c.list);

// Mutations: manager-tier and above.
userGroupsRouter.post('/', requireRole(...MANAGER_TIER), c.create);
userGroupsRouter.patch('/:id', requireRole(...MANAGER_TIER), c.update);
userGroupsRouter.delete('/:id', requireRole(...MANAGER_TIER), c.remove);
userGroupsRouter.put('/assign', requireRole(...MANAGER_TIER), c.assignOne);
userGroupsRouter.patch('/:id/members', requireRole(...MANAGER_TIER), c.setMembers);
