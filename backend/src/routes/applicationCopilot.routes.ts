import { Router } from 'express';
import * as c from '../controllers/applicationCopilot.controller';

export const applicationCopilotRouter = Router();

// Literal path before the :id routes.
applicationCopilotRouter.post('/log-external', c.logExternal);

applicationCopilotRouter.post('/start', c.start);
applicationCopilotRouter.get('/:id', c.getState);
applicationCopilotRouter.patch('/:id/answers', c.updateAnswers);
applicationCopilotRouter.patch('/:id/cover-letter', c.updateCoverLetter);
applicationCopilotRouter.post('/:id/confirm', c.confirm);
