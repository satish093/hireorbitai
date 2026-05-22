import { Router } from 'express';
import { uploadResume } from '../middleware/upload';
import * as c from '../controllers/resumes.controller';

export const resumesRouter = Router();

resumesRouter.get('/consultant/:consultantId', c.listForConsultant);
// PDF / DOC / DOCX only, max 10 MB. Multer's fileFilter rejects others
// before the controller sees them; the surfaced error becomes a 400.
resumesRouter.post('/upload', uploadResume.single('file'), c.upload);
resumesRouter.get('/:id/download-url', c.downloadUrl);
resumesRouter.post('/:id/score', c.score);
resumesRouter.post('/:id/set-current', c.setCurrent);
resumesRouter.get('/:id/body', c.body);
// AI-tailor a resume for a specific job (Jobright-style "Fix My Resume").
resumesRouter.post('/tailor', c.tailorForJob);

// Deep tailoring workspace — sessions, reviewable edits, factor breakdown, diff.
resumesRouter.get('/:id/tailor-sessions', c.listTailorSessions);
resumesRouter.post('/:id/tailor-sessions', c.createTailorSession);
resumesRouter.get('/:id/tailor-sessions/:sessionId', c.getTailorSession);
resumesRouter.post('/:id/tailor-sessions/:sessionId/apply', c.applyTailorSession);
resumesRouter.patch('/:id/tailor-sessions/:sessionId/edits/:editId', c.patchTailorEdit);
resumesRouter.get('/:id/ats-factors', c.atsFactors);
resumesRouter.get('/:id/diff', c.diff);
