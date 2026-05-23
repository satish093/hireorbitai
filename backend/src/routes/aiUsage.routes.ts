import { Router } from 'express';
import { requireRole } from '../middleware/auth';
import { MANAGER_TIER } from '../types';
import * as c from '../controllers/aiUsage.controller';

export const aiUsageRouter = Router();

aiUsageRouter.use(requireRole(...MANAGER_TIER));
aiUsageRouter.get('/summary', c.summary);
aiUsageRouter.get('/logs', c.logs);
