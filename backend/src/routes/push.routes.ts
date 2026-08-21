import { Router } from 'express';
import * as c from '../controllers/push.controller';

// Mounted under /push behind the global requireAuth. Any authenticated user may
// register their own device for notifications.
export const pushRouter = Router();

pushRouter.post('/register', c.register);
pushRouter.post('/unregister', c.unregister);
