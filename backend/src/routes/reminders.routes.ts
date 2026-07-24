import { Router } from 'express';
import * as c from '../controllers/reminders.controller';

export const remindersRouter = Router();

remindersRouter.get('/', c.list);
remindersRouter.post('/', c.create);
remindersRouter.patch('/:id', c.update);
remindersRouter.post('/:id/complete', c.complete);
remindersRouter.delete('/:id', c.remove);
