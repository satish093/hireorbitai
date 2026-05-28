import { Router } from 'express';
import { requireRoleOrCapability } from '../middleware/auth';
import { ADMIN_TIER } from '../types';
import * as c from '../controllers/adminUsers.controller';

export const adminUsersRouter = Router();

// Every /admin/users/* surface is ADMIN_TIER (or a DEVELOPER granted `users`).
// Role change used to be MANAGER_TIER, but the matching /admin/users PAGE was
// already ADMIN_TIER-only — leaving the backend opener created hidden API
// access without UI clarity (a MANAGER could PATCH a role via curl with no
// /admin/users page to find users on). Rank guards inside setRole
// (assertOutranks + canAssignRole + assertNotLastSuperAdmin + self-protection)
// still bound exactly which users/roles the caller may touch.
adminUsersRouter.use(requireRoleOrCapability(ADMIN_TIER, 'users'));

adminUsersRouter.patch('/:id/role', c.setRole);

adminUsersRouter.get('/', c.list);
adminUsersRouter.get('/kpi', c.kpi);
adminUsersRouter.get('/audit', c.globalAuditLog);
adminUsersRouter.post('/bulk', c.bulk);
adminUsersRouter.get('/:id', c.get);
adminUsersRouter.get('/:id/audit', c.auditLog);
adminUsersRouter.get('/:id/sessions', c.sessions);
adminUsersRouter.patch('/:id/status', c.setStatus);
adminUsersRouter.patch('/:id/group', c.setGroup);
// DEVELOPER capability grants — handler hard-requires SUPER_ADMIN.
adminUsersRouter.patch('/:id/capabilities', c.setCapabilities);
adminUsersRouter.patch('/:id/notes', c.setNotes);
adminUsersRouter.post('/:id/send-password-reset', c.sendPasswordReset);
adminUsersRouter.post('/:id/force-password-change', c.forcePasswordChange);
adminUsersRouter.post('/:id/impersonate', c.impersonate);
adminUsersRouter.delete('/:id/sessions/:sessionId', c.revokeSession);
adminUsersRouter.delete('/:id/sessions', c.revokeAllSessions);
