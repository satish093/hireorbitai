import { Router } from 'express';
import { requireAuth, requireDevTools, requireRole } from '../middleware/auth';
import * as devTools from '../controllers/devTools.controller';

// Super-Admin DEV test panel API. Triple-gated:
//   1. requireDevTools — 404 unless env.devTools (force-off in production)
//   2. requireAuth      — a real (impersonated) session
//   3. requireRole(SUPER_ADMIN) — only the top tier can edit test configs
export const devToolsRouter = Router();

devToolsRouter.use(requireDevTools, requireAuth, requireRole('SUPER_ADMIN'));
devToolsRouter.get('/integrations', devTools.getIntegrations);
devToolsRouter.put('/integrations', devTools.putIntegration);
