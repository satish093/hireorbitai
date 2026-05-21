import { Router } from 'express';
import * as tv from '../controllers/taskViews.controller';

// Per-user saved task views. Scoped by req.user.id inside the controller —
// every user has their own list, so no role gate is needed (mirrors the
// per-user /tasks/filters routes). Auth is applied upstream in routes/index.ts.
export const taskViewsRouter = Router();

taskViewsRouter.get('/', tv.list);
taskViewsRouter.post('/', tv.create);
taskViewsRouter.patch('/:id', tv.update);
taskViewsRouter.delete('/:id', tv.remove);
