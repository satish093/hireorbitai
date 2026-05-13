import { Router } from 'express';
import * as c from '../controllers/glassdoor.controller';

export const glassdoorRouter = Router();

// Interview-prep enrichment from Glassdoor Real-Time. Auth required (the
// route is mounted behind requireAuth in routes/index.ts).
glassdoorRouter.get('/interview/:id', c.interview);
