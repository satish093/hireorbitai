import { Router } from 'express';
import { uploadResume, verifyUploadMagic, scanUpload } from '../middleware/upload';
import * as c from '../controllers/resumes.controller';
import { requireRole } from '../middleware/auth';
import { OPERATOR_TIER } from '../types';

export const resumesRouter = Router();

// Resume access is two-tier:
//   - SELF endpoints (upload / list / download / set-current / view / delete /
//     re-extract) are open to a CONSULTANT for their OWN resume, plus the full
//     OPERATOR_TIER. Every handler calls authorizeConsultantAccess(), which
//     scopes a CONSULTANT strictly to their own consultant row (404 otherwise),
//     so there is no cross-user leakage.
//   - AI / tailoring tools (score, tailor, tailor-sessions, ats-factors, diff,
//     parse-profile) stay OPERATOR_TIER only — consultants don't run the
//     recruiter AI tooling (and it spends AI budget).
const selfOrOperator = requireRole(...OPERATOR_TIER, 'CONSULTANT');
const operatorOnly = requireRole(...OPERATOR_TIER);

resumesRouter.use(selfOrOperator);

// ── Self endpoints (consultant may act on their OWN resume) ─────────────────
resumesRouter.get('/consultant/:consultantId', c.listForConsultant);
// PDF / JPG / PNG / WEBP / DOC / DOCX only, max 10 MB. Multer's fileFilter
// rejects others before the controller sees them; the surfaced error becomes a 400.
resumesRouter.post('/upload', uploadResume.single('file'), verifyUploadMagic, scanUpload, c.upload);
resumesRouter.get('/:id/download-url', c.downloadUrl);
// Re-extract readable text from an already-uploaded file (for versions
// uploaded before server-side extraction existed).
resumesRouter.post('/:id/reextract', c.reextract);
resumesRouter.post('/:id/set-current', c.setCurrent);
resumesRouter.get('/:id/body', c.body);
resumesRouter.delete('/:id', c.deleteVersion);

// ── Operator-only AI / tailoring tools ──────────────────────────────────────
resumesRouter.post('/:id/score', operatorOnly, c.score);
// AI-tailor a resume for a specific job (Jobright-style "Fix My Resume").
resumesRouter.post('/tailor', operatorOnly, c.tailorForJob);

// Deep tailoring workspace — sessions, reviewable edits, factor breakdown, diff.
resumesRouter.get('/:id/tailor-sessions', operatorOnly, c.listTailorSessions);
resumesRouter.post('/:id/tailor-sessions', operatorOnly, c.createTailorSession);
resumesRouter.get('/:id/tailor-sessions/:sessionId', operatorOnly, c.getTailorSession);
resumesRouter.post('/:id/tailor-sessions/:sessionId/apply', operatorOnly, c.applyTailorSession);
resumesRouter.patch(
  '/:id/tailor-sessions/:sessionId/edits/:editId',
  operatorOnly,
  c.patchTailorEdit,
);
resumesRouter.get('/:id/ats-factors', operatorOnly, c.atsFactors);
resumesRouter.get('/:id/diff', operatorOnly, c.diff);
resumesRouter.post('/:id/parse-profile', operatorOnly, c.parseProfile);
