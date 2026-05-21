import { Router } from 'express';
import * as c from '../controllers/activity.controller';

export const activityRouter = Router();

// Aggregated activity feed for the dashboard. Auth is applied upstream in
// routes/index.ts; the handler scopes results to what the caller may see.
activityRouter.get('/', c.feed);
