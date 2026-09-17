import { Router } from 'express';
import { requireRole } from '../middleware/auth';
import { OPERATOR_TIER, ADMIN_TIER } from '../types';
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
// Consultant self-apply (LinkedIn Application Copilot + the existing "Yes, I
// applied" confirm flow) both need to call this — self-scoped inside fromJob
// via assertCanActOnConsultant, so opening the route gate is safe.
applicationsRouter.post('/from-job', c.fromJob);
applicationsRouter.patch('/:id', operatorOnly, c.update);
// Hard-delete is admin-tier only — destructive (cascades to interviews + the
// apply-funnel event log), so it sits above the operator gate.
applicationsRouter.delete('/:id', requireRole(...ADMIN_TIER), c.remove);
applicationsRouter.post('/:id/ats-score', operatorOnly, c.runAtsScore);
// Consultant-safe single-application detail + activity log — both self-scope
// via loadAndAuthorize (404-not-403), same pattern as /mine. Registered after
// the operator-only literal routes above but the :id here can't collide with
// them (Express matches literal segments first).
applicationsRouter.get('/:id', c.getById);
applicationsRouter.get('/:id/events', c.listEvents);
applicationsRouter.post('/:id/events', operatorOnly, c.appendEvent);
