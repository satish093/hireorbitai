import { Router } from 'express';
import { requireRoleOrCapability } from '../middleware/auth';
import { MANAGER_TIER, OPERATOR_TIER } from '../types';
import * as c from '../controllers/userGroups.controller';

export const userGroupsRouter = Router();

const gate = requireRoleOrCapability(MANAGER_TIER, 'user_groups');

// Diagnostics expose org/group structure — manager-tier (or DEVELOPER granted
// `user_groups`) only.
userGroupsRouter.get('/diag', gate, c.diag);
// The group list backs selectors (invite form, group badges) used across the
// operator surface, so it is OPERATOR_TIER+ — consultants never need it and
// shouldn't be able to enumerate the org's group structure.
userGroupsRouter.get('/', requireRoleOrCapability(OPERATOR_TIER, 'user_groups'), c.list);

// Mutations: manager-tier and above (or a DEVELOPER granted user_groups).
userGroupsRouter.post('/', gate, c.create);
userGroupsRouter.patch('/:id', gate, c.update);
userGroupsRouter.delete('/:id', gate, c.remove);
userGroupsRouter.put('/assign', gate, c.assignOne);
userGroupsRouter.patch('/:id/members', gate, c.setMembers);
