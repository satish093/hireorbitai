import { Router } from 'express';
import * as c from '../controllers/messages.controller';
import * as att from '../controllers/messageAttachments.controller';
import { uploadAttachment, verifyUploadMagic } from '../middleware/upload';

export const messagesRouter = Router();

// Literal paths first so they don't fall into /:userId-style matches.
messagesRouter.get('/contacts/allowed', c.contactsAllowed);
messagesRouter.get('/directory', c.directory);
messagesRouter.get('/conversations', c.conversations);
messagesRouter.get('/unread-count', c.unreadCount);

// Attachment upload (multipart). Two-phase: file lands here as an "orphan"
// (message_id = NULL), the subsequent POST /messages call claims it via
// attachment_ids. uploadAttachment caps at 15 MB + MIME/ext allowlist;
// verifyUploadMagic checks bytes match the declared MIME. Mounted BEFORE
// /:id-style routes so the literal `/attachments` matches first.
messagesRouter.post('/attachments', uploadAttachment.single('file'), verifyUploadMagic, att.upload);
messagesRouter.delete('/attachments/:id', att.remove);

messagesRouter.post('/', c.send);

messagesRouter.get('/with/:userId', c.thread);
messagesRouter.post('/with/:userId/read', c.markRead);
messagesRouter.post('/with/:userId/typing', c.typing);

// Sender-initiated retract + edit. Authorization (sender_id match) is
// enforced inside the controller via a composite WHERE so a forged id
// can't flip a message the caller doesn't own.
messagesRouter.patch('/:id', c.edit);
messagesRouter.delete('/:id', c.remove);
