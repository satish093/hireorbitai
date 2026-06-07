import { Router } from 'express';
import { requireRoleOrCapability } from '../middleware/auth';
import { ADMIN_TIER, OPERATOR_TIER } from '../types';
import { uploadImage, verifyUploadMagic, scanUpload } from '../middleware/upload';
import * as c from '../controllers/userGroups.controller';

export const userGroupsRouter = Router();

// Groups are global, workspace-wide objects: only ADMIN_TIER (or a DEVELOPER
// granted `user_groups`) may create/edit/delete them or move members. Group
// leads are scoped to their OWN group elsewhere and don't administer groups.
const gate = requireRoleOrCapability(ADMIN_TIER, 'user_groups');

// Diagnostics expose org/group structure — admin-tier (or DEVELOPER granted
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

// Per-group company logo. Image-only upload (PNG/JPEG/WebP, 2 MB), magic-byte +
// virus checked like every other upload route. Same admin gate as the mutations.
userGroupsRouter.post(
  '/:id/logo',
  gate,
  uploadImage.single('file'),
  verifyUploadMagic,
  scanUpload,
  c.uploadLogo,
);
userGroupsRouter.delete('/:id/logo', gate, c.removeLogo);
