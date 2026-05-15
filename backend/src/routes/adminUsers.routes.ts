import { Router } from 'express';
import { requireAdmin } from '../middleware/auth';
import * as c from '../controllers/adminUsers.controller';

export const adminUsersRouter = Router();

// Every route here requires the admin tier (SUPER_ADMIN / CEO / CTO / DIRECTOR).
adminUsersRouter.use(requireAdmin);

adminUsersRouter.get('/',                          c.list);
adminUsersRouter.get('/:id',                       c.get);
adminUsersRouter.get('/:id/audit',                 c.auditLog);
adminUsersRouter.patch('/:id/status',              c.setStatus);
adminUsersRouter.patch('/:id/notes',               c.setNotes);
adminUsersRouter.post('/:id/send-password-reset',  c.sendPasswordReset);
