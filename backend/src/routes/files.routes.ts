import { Router } from 'express';
import { createReadStream, promises as fs } from 'node:fs';
import { resolveOnDisk, verifyDownloadSignature } from '../config/storage.local';
import { httpError } from '../types';

// Allowlist of MIME types permitted to be served with their declared content-type.
// Any type not in this list is downgraded to application/octet-stream so the
// browser downloads the file rather than rendering potentially hostile content.
const MIME_ALLOWLIST = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'text/plain',
]);

export const filesRouter = Router();

/**
 * Public download endpoint for HMAC-signed file URLs minted by
 * `db.storage.from(bucket).createSignedUrl(path, ttl)`. Mounted at
 * `/api/files/:bucket/*` from routes/index.ts (and at /files for the
 * non-/api-prefixed deployment shape).
 *
 * URL shape: `/api/files/<bucket>/<...path>?exp=<unix>&sig=<hex>`
 * - exp:  expiry timestamp (seconds since epoch). 410 once past.
 * - sig:  hex sha256 HMAC of `bucket:path:exp` using env.storage.urlSecret.
 *
 * Path traversal is rejected up front by storage.local.sanitizePath().
 */
filesRouter.get('/:bucket/*', async (req, res, next) => {
  try {
    const bucket = String(req.params.bucket);
    const p = String((req.params as { 0?: string })[0] ?? '');
    const exp = Number(req.query.exp);
    const sig = String(req.query.sig ?? '');
    if (!Number.isFinite(exp) || !sig) throw httpError(400, 'Missing signature');
    if (!verifyDownloadSignature({ bucket, path: p, expiresAt: exp, sig })) {
      throw httpError(403, 'Invalid or expired download URL');
    }
    const fullPath = resolveOnDisk(bucket, p);
    const stat = await fs.stat(fullPath).catch(() => null);
    if (!stat || !stat.isFile()) throw httpError(404, 'Not found');
    // Echo back the content-type stored at upload time if available.
    let contentType = 'application/octet-stream';
    try {
      const meta = await fs.readFile(fullPath + '.meta', 'utf8');
      const parsed = JSON.parse(meta) as { contentType?: string };
      if (parsed.contentType && MIME_ALLOWLIST.has(parsed.contentType)) {
        contentType = parsed.contentType;
      }
    } catch {
      /* no meta, use default */
    }
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', String(stat.size));
    res.setHeader('Content-Disposition', 'attachment');
    res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
    createReadStream(fullPath).pipe(res);
  } catch (err) {
    next(err);
  }
});
