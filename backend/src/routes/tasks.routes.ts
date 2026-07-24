import { Router } from 'express';
import * as t from '../controllers/tasks.controller';
import * as tc from '../controllers/taskComments.controller';
import * as ta from '../controllers/taskAttachments.controller';
import * as tf from '../controllers/taskFilters.controller';
import { requireRole } from '../middleware/auth';
import { MANAGER_TIER } from '../types';
import { uploadAttachment, verifyUploadMagic, scanUpload } from '../middleware/upload';

export const tasksRouter = Router();

// More-specific routes BEFORE :id so they don't match as IDs.
tasksRouter.get('/metrics', requireRole(...MANAGER_TIER), t.metrics);
tasksRouter.get('/assignees', requireRole(...MANAGER_TIER), t.assignees);
tasksRouter.get('/assigned-to-me', t.assignedToMe);
tasksRouter.get('/team', requireRole(...MANAGER_TIER), t.teamTasks);

// Saved task filters (per-user presets). Scoped by req.user.id inside the
// controller — every user has their own list, no role gate needed.
tasksRouter.get('/filters', tf.list);
tasksRouter.post('/filters', tf.create);
tasksRouter.patch('/filters/:id', tf.update);
tasksRouter.delete('/filters/:id', tf.remove);

tasksRouter.get('/', t.list);
tasksRouter.post('/', requireRole(...MANAGER_TIER), t.create);

tasksRouter.get('/:id', t.get);
tasksRouter.patch('/:id', t.update);
tasksRouter.patch('/:id/status', t.updateStatus);
tasksRouter.delete('/:id', requireRole(...MANAGER_TIER), t.remove);

// Subtasks (checklist items). assertCanAccessTask inside the controller gates
// visibility (assignee/creator/manager), so requireAuth upstream is enough.
// Top-level /subtasks/:id is registered first so it doesn't get shadowed by a
// /:id/* pattern.
tasksRouter.patch('/subtasks/:id', t.updateSubtask);
tasksRouter.delete('/subtasks/:id', t.removeSubtask);
tasksRouter.get('/:id/subtasks', t.listSubtasks);
tasksRouter.post('/:id/subtasks', t.createSubtask);

// Activity feed.
tasksRouter.get('/:id/activity', t.listActivity);

// Comments. POST writes a task_activity row (kind='comment') so it shows up in
// the activity feed the task detail pane reads. The legacy task_comments
// GET/DELETE stay for the older TaskDetail page.
tasksRouter.post('/:id/comments', t.createComment);
tasksRouter.get('/:taskId/comments', tc.list);
tasksRouter.delete('/comments/:id', tc.remove);

// Attachments
tasksRouter.get('/:taskId/attachments', ta.list);
// Docs / images / spreadsheets / text only, max 15 MB. See uploadAttachment
// in middleware/upload.ts for the exact mime+ext allowlist.
tasksRouter.post(
  '/:taskId/attachments',
  uploadAttachment.single('file'),
  verifyUploadMagic,
  scanUpload,
  ta.upload,
);
tasksRouter.delete('/attachments/:id', ta.remove);
