import { Router } from 'express';
import { upload as multerUpload } from '../middleware/upload';
import * as c from '../controllers/resumes.controller';

export const resumesRouter = Router();

resumesRouter.get('/consultant/:consultantId', c.listForConsultant);
resumesRouter.post('/upload', multerUpload.single('file'), c.upload);
resumesRouter.get('/:id/download-url', c.downloadUrl);
resumesRouter.post('/:id/score', c.score);
resumesRouter.post('/:id/set-current', c.setCurrent);
resumesRouter.get('/:id/body', c.body);
// AI-tailor a resume for a specific job (Jobright-style "Fix My Resume").
resumesRouter.post('/tailor', c.tailorForJob);
