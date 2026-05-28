import multer from 'multer';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { httpError } from '../types';

/**
 * Upload middleware factory + a magic-byte verifier.
 *
 *   uploadResume     — for /resumes/upload (PDF / image / DOC / DOCX), 10 MB
 *   uploadAttachment — for /tasks/:id/attachments + work-auth docs, 15 MB
 *   verifyUploadMagic — post-multer middleware that re-checks the file's
 *                       first bytes match the claimed extension. Defends
 *                       against rename attacks (eg. "resume.pdf" whose body
 *                       is actually an executable).
 *
 * Wire on a route as:  router.post(path, uploadResume.single('file'),
 *                                  verifyUploadMagic, controller.upload);
 */

const MB = 1024 * 1024;

const RESUME_MIME = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  // Word documents — .doc (legacy binary) + .docx (OOXML). Some browsers send a
  // generic octet-stream for .doc, so the extension check below is the backstop.
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/octet-stream',
]);
const RESUME_EXT = /\.(pdf|jpe?g|png|webp|docx?)$/i;

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

// ---------------------------------------------------------------------------
// Magic-byte verification
// ---------------------------------------------------------------------------
//
// MIME + extension checks alone are forge-able — the browser sends whatever
// the user-agent claims, and the filename is user-supplied. A magic-byte
// check ("does the first few bytes of the body match what the extension
// promises?") catches rename attacks where someone uploads an executable
// renamed `resume.pdf`. We do it after multer has buffered the file in
// memory so we have the bytes to inspect.
//
// Types with no reliable signature (txt, csv) skip the magic check — they're
// plain-text by definition and the rest of the pipeline treats them as bytes.

interface Signature {
  /** Bytes to compare (matches must equal these exact octets). */
  bytes: number[];
  /** Where to start matching from. */
  offset?: number;
  /** Optional extra match at a different offset (e.g. WebP's "WEBP" at +8). */
  also?: { bytes: number[]; offset: number };
}

/** Magic-byte signatures per file extension. An ext may have multiple. */
const SIGNATURES: Record<string, Signature[]> = {
  pdf: [{ bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] }], // "%PDF-"
  jpg: [{ bytes: [0xff, 0xd8, 0xff] }],
  jpeg: [{ bytes: [0xff, 0xd8, 0xff] }],
  png: [{ bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }],
  webp: [
    {
      // "RIFF" at 0, "WEBP" at 8 (size bytes in between vary).
      bytes: [0x52, 0x49, 0x46, 0x46],
      also: { bytes: [0x57, 0x45, 0x42, 0x50], offset: 8 },
    },
  ],
  gif: [
    { bytes: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61] }, // GIF87a
    { bytes: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61] }, // GIF89a
  ],
  // OOXML (docx/xlsx/pptx) is a ZIP archive — "PK\x03\x04" (also "PK\x05\x06"
  // for an empty archive, "PK\x07\x08" for a spanned archive).
  docx: [
    { bytes: [0x50, 0x4b, 0x03, 0x04] },
    { bytes: [0x50, 0x4b, 0x05, 0x06] },
    { bytes: [0x50, 0x4b, 0x07, 0x08] },
  ],
  xlsx: [
    { bytes: [0x50, 0x4b, 0x03, 0x04] },
    { bytes: [0x50, 0x4b, 0x05, 0x06] },
    { bytes: [0x50, 0x4b, 0x07, 0x08] },
  ],
  // Legacy MS Compound Document (Office 97-2003).
  doc: [{ bytes: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] }],
  xls: [{ bytes: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] }],
};

/** Plain-text formats with no useful binary signature — skip the magic check. */
const SKIP_MAGIC = new Set(['txt', 'csv']);

function matchBytes(buffer: Buffer, sig: Signature): boolean {
  const off = sig.offset ?? 0;
  if (buffer.length < off + sig.bytes.length) return false;
  for (let i = 0; i < sig.bytes.length; i++) {
    if (buffer[off + i] !== sig.bytes[i]) return false;
  }
  if (sig.also) {
    const a = sig.also;
    if (buffer.length < a.offset + a.bytes.length) return false;
    for (let i = 0; i < a.bytes.length; i++) {
      if (buffer[a.offset + i] !== a.bytes[i]) return false;
    }
  }
  return true;
}

function extOf(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  return (m?.[1] ?? '').toLowerCase();
}

/**
 * Returns true if `buffer` matches one of the known signatures for `ext`.
 * Unknown extensions (or text formats in SKIP_MAGIC) return true — those
 * had nothing to verify against. The mime + extension check in buildFilter
 * is the first-line gate; this is the second-line content check.
 *
 * Exported so unit tests can exercise the matcher directly.
 */
export function bufferMatchesExtension(buffer: Buffer, name: string): boolean {
  const ext = extOf(name);
  if (!ext) return true;
  if (SKIP_MAGIC.has(ext)) return true;
  const sigs = SIGNATURES[ext];
  if (!sigs) return true; // ext we don't have signatures for — let it through
  return sigs.some((s) => matchBytes(buffer, s));
}

/**
 * Express middleware: re-validates `req.file.buffer` against the claimed
 * extension. Wire AFTER the multer upload middleware. 400s on a mismatch
 * with a clear error so the frontend can surface it.
 */
export const verifyUploadMagic: RequestHandler = (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  const file = (req as Request & { file?: Express.Multer.File }).file;
  if (!file?.buffer) return next(); // no file → let the controller decide
  if (!bufferMatchesExtension(file.buffer, file.originalname)) {
    return next(
      httpError(
        400,
        `Uploaded file's contents do not match its extension (${file.originalname}). ` +
          `If you renamed a file to change its type, please re-export it in the correct format.`,
      ),
    );
  }
  return next();
};
