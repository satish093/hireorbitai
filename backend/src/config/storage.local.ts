/**
 * HireOrbit AI — local filesystem storage.
 *
 * Drop-in replacement for the storage subset we used:
 *   storage.from(bucket).upload(path, buffer, { contentType })
 *   storage.from(bucket).remove([paths])
 *   storage.from(bucket).createSignedUrl(path, expiresInSec)
 *   storage.from(bucket).getPublicUrl(path)
 *
 * Files live under env.storage.uploadsDir/<bucket>/<path>. Signed URLs are
 * HMAC-protected short-lived links served by routes/files.routes.ts.
 *
 * The "bucket" concept survives so we can keep callsites unchanged, but each
 * bucket is just a top-level subdirectory on disk.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { env } from './env';

interface StorageError {
  message: string;
}
interface StorageResp<T> {
  data: T | null;
  error: StorageError | null;
}

// Reject path traversal aggressively — no '..', no absolute paths, no nulls.
function sanitizePath(input: string): string {
  if (!input || input.includes('\0')) throw new Error('storage: invalid path');
  // Normalize separators, then validate.
  const norm = input.replaceAll('\\', '/');
  if (norm.startsWith('/') || norm.includes('..')) throw new Error('storage: invalid path');
  // Each segment must be a "safe" filename character set.
  for (const seg of norm.split('/')) {
    if (!/^[a-zA-Z0-9._-]+$/.test(seg)) throw new Error('storage: invalid path segment');
  }
  return norm;
}

function safeBucket(bucket: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(bucket)) throw new Error('storage: invalid bucket');
  return bucket;
}

async function ensureParent(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

function signUrl(bucket: string, p: string, expiresAt: number): string {
  const msg = `${bucket}:${p}:${expiresAt}`;
  return createHmac('sha256', env.storage.urlSecret).update(msg).digest('hex');
}

export function verifyDownloadSignature(args: {
  bucket: string;
  path: string;
  expiresAt: number;
  sig: string;
}): boolean {
  if (!Number.isFinite(args.expiresAt) || Date.now() / 1000 > args.expiresAt) return false;
  let expected: string;
  try {
    expected = signUrl(args.bucket, args.path, args.expiresAt);
  } catch {
    // Bucket / path failed validation — fail closed.
    return false;
  }
  // Constant-time compare; bail on length mismatch first so timingSafeEqual
  // doesn't throw on unequal buffers.
  if (expected.length !== args.sig.length) return false;
  return timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(args.sig, 'utf8'));
}

export function resolveOnDisk(bucket: string, p: string): string {
  return path.join(env.storage.uploadsDir, safeBucket(bucket), sanitizePath(p));
}

class Bucket {
  constructor(private bucket: string) {}

  async upload(
    p: string,
    buffer: Buffer,
    opts?: { contentType?: string; upsert?: boolean },
  ): Promise<StorageResp<{ path: string }>> {
    try {
      const full = resolveOnDisk(this.bucket, p);
      await ensureParent(full);
      if (!opts?.upsert) {
        // Default upsert:false → fail if exists.
        try {
          await fs.access(full);
          return { data: null, error: { message: 'File already exists' } };
        } catch {
          /* ok, doesn't exist */
        }
      }
      await fs.writeFile(full, buffer);
      // Persist content-type as a sibling marker file so download can echo it.
      if (opts?.contentType) {
        await fs.writeFile(full + '.meta', JSON.stringify({ contentType: opts.contentType }));
      }
      return { data: { path: p }, error: null };
    } catch (err) {
      return {
        data: null,
        error: { message: err instanceof Error ? err.message : 'upload failed' },
      };
    }
  }

  async remove(paths: string[]): Promise<StorageResp<unknown>> {
    try {
      for (const p of paths) {
        const full = resolveOnDisk(this.bucket, p);
        await fs.unlink(full).catch(() => {});
        await fs.unlink(full + '.meta').catch(() => {});
      }
      return { data: {}, error: null };
    } catch (err) {
      return {
        data: null,
        error: { message: err instanceof Error ? err.message : 'remove failed' },
      };
    }
  }

  /**
   * Return a short-lived HMAC-signed URL that points at /api/files/:bucket/:path.
   * The download route validates the signature + expiry before streaming the file.
   */
  async createSignedUrl(
    p: string,
    expiresInSec: number,
  ): Promise<StorageResp<{ signedUrl: string; path: string; token: string }>> {
    try {
      sanitizePath(p);
      const exp = Math.floor(Date.now() / 1000) + expiresInSec;
      const sig = signUrl(this.bucket, p, exp);
      const base = env.appUrl.replace(/\/+$/, '');
      const url =
        `${base}/api/files/${encodeURIComponent(safeBucket(this.bucket))}/` +
        p.split('/').map(encodeURIComponent).join('/') +
        `?exp=${exp}&sig=${sig}`;
      return { data: { signedUrl: url, path: p, token: sig }, error: null };
    } catch (err) {
      return { data: null, error: { message: err instanceof Error ? err.message : 'sign failed' } };
    }
  }

  getPublicUrl(p: string): { data: { publicUrl: string } } {
    const base = env.appUrl.replace(/\/+$/, '');
    return {
      data: {
        publicUrl:
          `${base}/api/files/${encodeURIComponent(safeBucket(this.bucket))}/` +
          p.split('/').map(encodeURIComponent).join('/'),
      },
    };
  }
}

export function from(bucket: string): Bucket {
  return new Bucket(bucket);
}

/** Default bucket for resume uploads (kept for compat with old code paths). */
export const STORAGE_BUCKET = 'resumes';
