import { Router } from 'express';
import * as c from '../controllers/ai.controller';

export const aiRouter = Router();

aiRouter.post('/resume-score', c.resumeScore);
aiRouter.post('/ats-score', c.ats);
aiRouter.post('/vendor-email', c.vendorEmail);
