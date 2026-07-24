import { Router } from 'express';
import { requireRoleOrCapability } from '../middleware/auth';
import { MANAGER_TIER, OPERATOR_TIER } from '../types';
import * as c from '../controllers/reports.controller';

export const reportsRouter = Router();

const operatorGate = requireRoleOrCapability(OPERATOR_TIER, 'reports');
const managerGate = requireRoleOrCapability(MANAGER_TIER, 'reports');

// Daily activity logging — recruiters log their own work; managers can read all.
reportsRouter.get('/daily', operatorGate, c.listDaily);
reportsRouter.post('/daily', operatorGate, c.upsertDaily);

// Manager-and-above analytics.
reportsRouter.get('/manager-summary', managerGate, c.managerSummary);
reportsRouter.get('/recruiter-performance', managerGate, c.recruiterPerformance);
reportsRouter.get('/consultant-pipeline', managerGate, c.consultantPipeline);
reportsRouter.get('/placement-analytics', managerGate, c.placementAnalytics);
// Time-in-app — per-user from the heartbeat-derived activity counter.
reportsRouter.get('/user-time', managerGate, c.userTime);

// ---------------------------------------------------------------------------
// Redesigned Reports analytics — range + compareToPrior aware.
// ---------------------------------------------------------------------------
// Submissions reports — grouped by consultant / recruiter, daily/weekly/monthly.
// OPERATOR_TIER so a RECRUITER can self-report (scoped to their own rows inside
// the handler); CONSULTANT is excluded by the tier. Group leads are group-scoped,
// admin-tier unscoped — all enforced in the controller.
reportsRouter.get('/submissions/by-consultant', operatorGate, c.submissionsByConsultant);
reportsRouter.get('/submissions/by-recruiter', operatorGate, c.submissionsByRecruiter);

reportsRouter.get('/pipeline', managerGate, c.pipelineReport);
reportsRouter.get('/recruiters', managerGate, c.recruitersReport);
reportsRouter.get('/consultants', managerGate, c.consultantsReport);
reportsRouter.get('/placements', managerGate, c.placementsReport);
reportsRouter.get('/sources', managerGate, c.sourcesReport);
