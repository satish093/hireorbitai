import { Router } from 'express';
import { uploadAttachment, verifyUploadMagic, scanUpload } from '../middleware/upload';
import * as c from '../controllers/workAuthDocs.controller';

export const workAuthDocsRouter = Router();

workAuthDocsRouter.get('/:consultantId', c.list);
workAuthDocsRouter.post(
  '/:consultantId',
  uploadAttachment.single('file'),
  verifyUploadMagic,
  scanUpload,
  c.upload,
);
workAuthDocsRouter.get('/:consultantId/:docId/download', c.downloadUrl);
workAuthDocsRouter.delete('/:consultantId/:docId', c.remove);
