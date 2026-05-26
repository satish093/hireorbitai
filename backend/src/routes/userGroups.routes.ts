import { Router } from 'express';
import { requireRoleOrCapability } from '../middleware/auth';
import { MANAGER_TIER } from '../types';
import * as c from '../controllers/userGroups.controller';

export const userGroupsRouter = Router();

const gate = requireRoleOrCapability(MANAGER_TIER, 'user_groups');

// Everyone authenticated can read the list (used by selectors).
userGroupsRouter.get('/diag', c.diag);
userGroupsRouter.get('/', c.list);

// Mutations: manager-tier and above (or a DEVELOPER granted user_groups).
userGroupsRouter.post('/', gate, c.create);
userGroupsRouter.patch('/:id', gate, c.update);
userGroupsRouter.delete('/:id', gate, c.remove);
userGroupsRouter.put('/assign', gate, c.assignOne);
userGroupsRouter.patch('/:id/members', gate, c.setMembers);
