import { Router } from 'express';
import * as c from '../controllers/recruiterGoals.controller';

export const recruiterGoalsRouter = Router();

// Auth applied upstream in routes/index.ts. The caller reads/writes only their
// own goals (scoped to their recruiter row inside the handlers).
recruiterGoalsRouter.get('/', c.getGoals);
recruiterGoalsRouter.put('/', c.setGoals);
