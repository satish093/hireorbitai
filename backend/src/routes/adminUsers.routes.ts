import { Router } from 'express';
import { requireAdmin, requireRole } from '../middleware/auth';
import { MANAGER_TIER } from '../types';
import * as c from '../controllers/adminUsers.controller';

export const adminUsersRouter = Router();

// Role change: accessible to MANAGER_TIER+ (group restrictions enforced in handler)
adminUsersRouter.patch('/:id/role', requireRole(...MANAGER_TIER), c.setRole);

// Everything else requires admin tier
adminUsersRouter.use(requireAdmin);

adminUsersRouter.get('/', c.list);
adminUsersRouter.get('/kpi', c.kpi);
adminUsersRouter.get('/audit', c.globalAuditLog);
adminUsersRouter.post('/bulk', c.bulk);
adminUsersRouter.get('/:id', c.get);
adminUsersRouter.get('/:id/audit', c.auditLog);
adminUsersRouter.get('/:id/sessions', c.sessions);
adminUsersRouter.patch('/:id/status', c.setStatus);
adminUsersRouter.patch('/:id/group', c.setGroup);
adminUsersRouter.patch('/:id/notes', c.setNotes);
adminUsersRouter.post('/:id/send-password-reset', c.sendPasswordReset);
adminUsersRouter.post('/:id/force-password-change', c.forcePasswordChange);
adminUsersRouter.post('/:id/impersonate', c.impersonate);
adminUsersRouter.delete('/:id/sessions/:sessionId', c.revokeSession);
adminUsersRouter.delete('/:id/sessions', c.revokeAllSessions);
