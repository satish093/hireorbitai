import { Router } from 'express';
import * as c from '../controllers/applications.controller';

export const applicationsRouter = Router();

applicationsRouter.get('/', c.list);
applicationsRouter.get('/check-duplicate', c.checkDuplicate);
applicationsRouter.post('/', c.create);
applicationsRouter.post('/from-job', c.fromJob);
applicationsRouter.patch('/:id', c.update);
applicationsRouter.post('/:id/ats-score', c.runAtsScore);
applicationsRouter.get('/:id/events', c.listEvents);
applicationsRouter.post('/:id/events', c.appendEvent);
