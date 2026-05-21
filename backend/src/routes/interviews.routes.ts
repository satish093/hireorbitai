import { Router } from 'express';
import * as c from '../controllers/interviews.controller';

export const interviewsRouter = Router();

interviewsRouter.get('/', c.list);
// Register the static calendar routes BEFORE the parameterized `/:id` routes
// so Express doesn't treat 'conflicts' / 'next' as an interview id.
interviewsRouter.get('/conflicts', c.conflicts);
interviewsRouter.get('/next', c.next);
interviewsRouter.post('/', c.schedule);
interviewsRouter.post('/mock', c.scheduleMock);
interviewsRouter.patch('/:id', c.update);
interviewsRouter.post('/:id/feedback', c.submitFeedback);
