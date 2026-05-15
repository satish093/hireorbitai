import { Router } from 'express';
import * as t from '../controllers/tasks.controller';
import * as tc from '../controllers/taskComments.controller';
import * as ta from '../controllers/taskAttachments.controller';
import { requireRole } from '../middleware/auth';
import { MANAGER_TIER } from '../types';
import { uploadAttachment } from '../middleware/upload';

export const tasksRouter = Router();

// More-specific routes BEFORE :id so they don't match as IDs.
tasksRouter.get('/metrics', requireRole(...MANAGER_TIER), t.metrics);
tasksRouter.get('/assigned-to-me', t.assignedToMe);
tasksRouter.get('/team', requireRole(...MANAGER_TIER), t.teamTasks);

tasksRouter.get('/', t.list);
tasksRouter.post('/', requireRole(...MANAGER_TIER), t.create);

tasksRouter.get('/:id', t.get);
tasksRouter.patch('/:id', t.update);
tasksRouter.patch('/:id/status', t.updateStatus);
tasksRouter.delete('/:id', requireRole(...MANAGER_TIER), t.remove);

// Comments
tasksRouter.get('/:taskId/comments', tc.list);
tasksRouter.post('/:taskId/comments', tc.create);
tasksRouter.delete('/comments/:id', tc.remove);

// Attachments
tasksRouter.get('/:taskId/attachments', ta.list);
// Docs / images / spreadsheets / text only, max 15 MB. See uploadAttachment
// in middleware/upload.ts for the exact mime+ext allowlist.
tasksRouter.post('/:taskId/attachments', uploadAttachment.single('file'), ta.upload);
tasksRouter.delete('/attachments/:id', ta.remove);
