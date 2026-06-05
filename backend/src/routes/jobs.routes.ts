import { Router } from 'express';
import { requireRole } from '../middleware/auth';
import { requireFeature } from '../middleware/featureFlag';
import { MANAGER_TIER, OPERATOR_TIER } from '../types';
import * as c from '../controllers/jobs.controller';
import * as src from '../controllers/jobSources.controller';

export const jobsRouter = Router();
// `job_ingestion` flag — gates the SYNC/ENRICH/IMPORT endpoints only. The
// read-side job board (recommended/liked/applied + GET /:id) keeps working
// when ingestion is paused so existing rows stay visible.
const ingest = requireFeature('job_ingestion');

// More-specific routes BEFORE :id so they don't get matched as IDs.
jobsRouter.get('/recommended', c.recommended);
jobsRouter.get('/liked', c.liked);
jobsRouter.get('/applied', c.applied);
jobsRouter.get('/match/consultant/:consultantId', c.matchForConsultant);

// Live job ingestion (Jobright-style real-time pull)
jobsRouter.get('/sources/drivers', src.drivers);
jobsRouter.get('/sources/health', src.sourcesHealth);
jobsRouter.get('/sources', src.listSources);
jobsRouter.post('/sources', ingest, requireRole(...MANAGER_TIER), src.createSource);
jobsRouter.patch('/sources/:id', ingest, requireRole(...MANAGER_TIER), src.updateSource);
jobsRouter.delete('/sources/:id', ingest, requireRole(...MANAGER_TIER), src.deleteSource);
jobsRouter.post('/sources/:id/sync', ingest, requireRole(...MANAGER_TIER), src.syncOne);
jobsRouter.post('/sync', ingest, requireRole(...MANAGER_TIER), src.sync);

// AI batch enrichment (must come BEFORE /:id routes)
jobsRouter.post('/enrich-pending', ingest, requireRole(...MANAGER_TIER), c.enrichPending);

// Manual external-URL import (paste-a-link). Operator-tier and above.
jobsRouter.post('/import-url', ingest, requireRole(...OPERATOR_TIER), c.importByUrl);

jobsRouter.get('/', c.list);
jobsRouter.post('/', requireRole(...OPERATOR_TIER), c.create);
// /jobs/score was a CONSULTANT-only natural-language re-rank, but this router
// is mounted under requireRole(...OPERATOR_TIER) (consultants are excluded
// from /jobs/*), so the route was unreachable. Removed — consistent with the
// "consultants do not browse jobs" policy.

jobsRouter.get('/:id', c.get);
jobsRouter.patch('/:id', requireRole(...OPERATOR_TIER), c.update);
jobsRouter.delete('/:id', requireRole(...MANAGER_TIER), c.remove);

jobsRouter.post('/:id/like', c.like);
jobsRouter.delete('/:id/like', c.unlike);

// Dismiss / "Not interested" — removes the job from the caller's recommended feed.
jobsRouter.post('/:id/dismiss', c.dismiss);
jobsRouter.delete('/:id/dismiss', c.undismiss);

// Recruiter note — internal, operator-tier and above (consultants must not see
// or edit it). GET is gated too so the note stays staff-only.
jobsRouter.get('/:id/note', requireRole(...OPERATOR_TIER), c.getNote);
jobsRouter.patch('/:id/note', requireRole(...OPERATOR_TIER), c.setNote);

jobsRouter.get('/:id/match-for-me', c.matchForMe);
jobsRouter.get('/:id/requirements', requireRole(...OPERATOR_TIER), c.requirementsFor);
jobsRouter.get('/:id/skill-gap', c.skillGap);
jobsRouter.post('/:id/ats-match', c.atsMatch);
jobsRouter.post('/:id/enrich', ingest, requireRole(...OPERATOR_TIER), c.enrichOne);
jobsRouter.post('/:id/skill-match', c.skillMatchForMe);
jobsRouter.post('/:id/skill-match-for-me', c.skillMatchForMe);
jobsRouter.post('/:id/copilot', c.copilot);
jobsRouter.get('/:id/duplicate-check', c.duplicateCheck);
// Jobright-style apply funnel.
jobsRouter.post('/:id/apply-options', c.applyOptions);
jobsRouter.post('/:id/customize-resume', c.customizeResume);
jobsRouter.post('/:id/apply-confirm', c.applyConfirm);
