import { Router } from 'express';
import { requireRole } from '../middleware/auth';
import { OPERATOR_TIER } from '../types';
import * as c from '../controllers/applications.controller';

export const applicationsRouter = Router();

// The router is mounted behind requireRole(...BUSINESS_ROLES) (routes/index.ts),
// which admits CONSULTANT for the self-scoped /mine read below. Every OTHER
// endpoint exposes recruiter-side context (recruiter_id, ats_score, internal
// notes) and stays OPERATOR_TIER-only, gated per-route here so their
// authorization is unchanged from when the whole mount was OPERATOR_TIER.
const operatorOnly = requireRole(...OPERATOR_TIER);

// Consultant-safe self-read — reachable by any BUSINESS_ROLE; the handler
// self-scopes to the caller's own consultant row and returns a narrowed
// projection. Literal path registered before the :id routes.
applicationsRouter.get('/mine', c.listMine);

applicationsRouter.get('/', operatorOnly, c.list);
applicationsRouter.get('/check-duplicate', operatorOnly, c.checkDuplicate);
applicationsRouter.post('/', operatorOnly, c.create);
applicationsRouter.post('/from-job', operatorOnly, c.fromJob);
applicationsRouter.patch('/:id', operatorOnly, c.update);
applicationsRouter.post('/:id/ats-score', operatorOnly, c.runAtsScore);
applicationsRouter.get('/:id/events', operatorOnly, c.listEvents);
applicationsRouter.post('/:id/events', operatorOnly, c.appendEvent);
