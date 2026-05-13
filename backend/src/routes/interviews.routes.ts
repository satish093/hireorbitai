import { Router } from 'express';
import * as c from '../controllers/interviews.controller';

export const interviewsRouter = Router();

interviewsRouter.get('/', c.list);
interviewsRouter.post('/', c.schedule);
interviewsRouter.post('/mock', c.scheduleMock);
interviewsRouter.patch('/:id', c.update);
interviewsRouter.post('/:id/feedback', c.submitFeedback);
