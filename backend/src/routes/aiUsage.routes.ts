import { Router } from 'express';
import { requireRoleOrCapability } from '../middleware/auth';
import { MANAGER_TIER } from '../types';
import * as c from '../controllers/aiUsage.controller';

export const aiUsageRouter = Router();

aiUsageRouter.use(requireRoleOrCapability(MANAGER_TIER, 'ai_usage'));
aiUsageRouter.get('/summary', c.summary);
aiUsageRouter.get('/logs', c.logs);
