import { Router } from 'express';
import { requireRole } from '../middleware/auth';
import { MANAGER_TIER } from '../types';
import * as c from '../controllers/reports.controller';

export const reportsRouter = Router();

// Daily activity logging — recruiters log their own work; managers can read.
reportsRouter.get('/daily', c.listDaily);
reportsRouter.post('/daily', c.upsertDaily);

// Manager-and-above analytics.
reportsRouter.get('/manager-summary', requireRole(...MANAGER_TIER), c.managerSummary);
reportsRouter.get('/recruiter-performance', requireRole(...MANAGER_TIER), c.recruiterPerformance);
reportsRouter.get('/consultant-pipeline', requireRole(...MANAGER_TIER), c.consultantPipeline);
reportsRouter.get('/placement-analytics', requireRole(...MANAGER_TIER), c.placementAnalytics);
// Time-in-app — per-user from the heartbeat-derived activity counter.
reportsRouter.get('/user-time', requireRole(...MANAGER_TIER), c.userTime);
