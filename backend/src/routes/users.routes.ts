import { Router } from 'express';
import * as c from '../controllers/users.controller';
import { requireAdmin } from '../middleware/auth';

export const usersRouter = Router();

// Admin-only: create a new user with a Brevo-delivered temporary password.
// Forces a password change on first login.
usersRouter.post('/', requireAdmin, c.adminCreate);

// Permission checks live inside the controller (operator-tier sees all,
// consultants see only their own, manager-tier can edit anyone).
usersRouter.get('/:id', c.get);
usersRouter.patch('/:id', c.update);
