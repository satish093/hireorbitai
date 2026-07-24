import { Router } from 'express';
import { requireDevTools } from '../middleware/auth';
import * as devAuth from '../controllers/devAuth.controller';

// Development-only role/user switching. Every route is gated by requireDevTools
// (404 unless env.devTools, which is force-off in production). Mounted before
// requireAuth in routes/index.ts since the whole point is logging in with no
// existing session.
export const devAuthRouter = Router();

devAuthRouter.use(requireDevTools);
devAuthRouter.get('/users', devAuth.listUsers);
devAuthRouter.post('/login', devAuth.login);
