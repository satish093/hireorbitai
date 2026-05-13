import { Router } from 'express';
import * as c from '../controllers/messages.controller';

export const messagesRouter = Router();

// Literal paths first so they don't fall into /:userId-style matches.
messagesRouter.get('/directory', c.directory);
messagesRouter.get('/conversations', c.conversations);
messagesRouter.get('/unread-count', c.unreadCount);

messagesRouter.post('/', c.send);

messagesRouter.get('/with/:userId', c.thread);
messagesRouter.post('/with/:userId/read', c.markRead);
