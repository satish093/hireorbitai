import { Router } from 'express';
import { requireRoleOrCapability } from '../middleware/auth';
import { MANAGER_TIER, ADMIN_TIER } from '../types';
import * as c from '../controllers/adminUsers.controller';

export const adminUsersRouter = Router();

// Role change: MANAGER_TIER+ (or a DEVELOPER granted `users`). Rank guards in
// the handler (assertOutranks + assertNotLastSuperAdmin) still bound exactly
// which users/roles the caller may touch — a DEVELOPER can't escalate anyone
// to/above its own rank, and impersonation stays SUPER_ADMIN-only.
adminUsersRouter.patch('/:id/role', requireRoleOrCapability(MANAGER_TIER, 'users'), c.setRole);

// Everything else: admin tier (or a DEVELOPER granted `users`).
adminUsersRouter.use(requireRoleOrCapability(ADMIN_TIER, 'users'));

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
