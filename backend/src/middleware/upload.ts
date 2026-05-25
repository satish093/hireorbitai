import multer from 'multer';
import type { Request } from 'express';

/**
 * Upload middleware factory. Two presets ship with the app:
 *
 *   uploadResume     — for /resumes/upload (PDF + DOC/DOCX), 10 MB cap
 *   uploadAttachment — for /tasks/:id/attachments (PDF, images, common docs), 15 MB cap
 *
 * The default `upload` export below is a permissive fallback used only by
 * legacy code paths; new routes should pick the targeted preset so the
 * frontend's `accept` attribute and the backend's policy stay in lockstep.
 *
 * Validation here is mimetype + extension. Magic-byte sniffing would be more
 * robust against trickery — wire `file-type` in the controller layer if any
 * single attachment kind ever needs that level of defense.
 */

const MB = 1024 * 1024;

const RESUME_MIME = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
const RESUME_EXT = /\.(pdf|jpe?g|png|webp)$/i;

const ATTACHMENT_MIME = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'text/plain',
  'text/csv',
]);
const ATTACHMENT_EXT = /\.(pdf|doc|docx|xls|xlsx|png|jpe?g|webp|gif|txt|csv)$/i;

function buildFilter(mimes: Set<string>, extRegex: RegExp): multer.Options['fileFilter'] {
  return (_req: Request, file, cb) => {
    const mimeOk = mimes.has(file.mimetype);
    const extOk = extRegex.test(file.originalname);
    if (mimeOk && extOk) return cb(null, true);
    // Reject by passing an Error — multer surfaces it via the route's
    // error handler (errorHandler middleware turns it into a 400).
    cb(new Error(`File type not allowed: ${file.originalname} (${file.mimetype})`));
  };
}

/** Resume-specific uploader — PDF + images (JPEG/PNG/WebP), 10 MB max. */
export const uploadResume = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * MB, files: 1 },
  fileFilter: buildFilter(RESUME_MIME, RESUME_EXT),
});

/** Task attachment uploader — docs + images + spreadsheets, 15 MB max. */
export const uploadAttachment = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * MB, files: 1 },
  fileFilter: buildFilter(ATTACHMENT_MIME, ATTACHMENT_EXT),
});

/** Permissive fallback — kept for any legacy route that imports it.
 *  Prefer uploadResume / uploadAttachment for new code. */
export const upload = uploadAttachment;
