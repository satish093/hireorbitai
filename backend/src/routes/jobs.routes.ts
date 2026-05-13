import { Router } from 'express';
import { requireRole } from '../middleware/auth';
import { MANAGER_TIER, OPERATOR_TIER } from '../types';
import * as c from '../controllers/jobs.controller';
import * as src from '../controllers/jobSources.controller';

export const jobsRouter = Router();

// More-specific routes BEFORE :id so they don't get matched as IDs.
jobsRouter.get('/recommended', c.recommended);
jobsRouter.get('/liked', c.liked);
jobsRouter.get('/applied', c.applied);
jobsRouter.get('/match/consultant/:consultantId', c.matchForConsultant);

// Live job ingestion (Jobright-style real-time pull)
jobsRouter.get('/sources/drivers', src.drivers);
jobsRouter.get('/sources/health', src.sourcesHealth);
jobsRouter.get('/sources', src.listSources);
jobsRouter.post('/sources', requireRole(...MANAGER_TIER), src.createSource);
jobsRouter.patch('/sources/:id', requireRole(...MANAGER_TIER), src.updateSource);
jobsRouter.delete('/sources/:id', requireRole(...MANAGER_TIER), src.deleteSource);
jobsRouter.post('/sources/:id/sync', requireRole(...MANAGER_TIER), src.syncOne);
jobsRouter.post('/sync', requireRole(...MANAGER_TIER), src.sync);

// AI batch enrichment (must come BEFORE /:id routes)
jobsRouter.post('/enrich-pending', requireRole(...MANAGER_TIER), c.enrichPending);

// Manual external-URL import (paste-a-link). Operator-tier and above.
jobsRouter.post('/import-url', requireRole(...OPERATOR_TIER), c.importByUrl);

jobsRouter.get('/', c.list);
jobsRouter.post('/', requireRole(...OPERATOR_TIER), c.create);

jobsRouter.get('/:id', c.get);
jobsRouter.patch('/:id', requireRole(...OPERATOR_TIER), c.update);
jobsRouter.delete('/:id', requireRole(...MANAGER_TIER), c.remove);

jobsRouter.post('/:id/like', c.like);
jobsRouter.delete('/:id/like', c.unlike);

jobsRouter.get('/:id/match-for-me', c.matchForMe);
jobsRouter.get('/:id/requirements', c.requirementsFor);
jobsRouter.post('/:id/ats-match', c.atsMatch);
jobsRouter.post('/:id/enrich', c.enrichOne);
jobsRouter.post('/:id/skill-match', c.skillMatchForMe);
jobsRouter.post('/:id/skill-match-for-me', c.skillMatchForMe);
jobsRouter.get('/:id/duplicate-check', c.duplicateCheck);
// Jobright-style apply funnel.
jobsRouter.post('/:id/apply-options', c.applyOptions);
jobsRouter.post('/:id/customize-resume', c.customizeResume);
jobsRouter.post('/:id/apply-confirm', c.applyConfirm);
