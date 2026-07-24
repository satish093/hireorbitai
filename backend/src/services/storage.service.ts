import { promises as fs } from 'node:fs';
import { db } from '../config/db';
import { STORAGE_BUCKET, resolveOnDisk } from '../config/storage.local';
import { httpError } from '../types';

/** Read a stored resume file back into a Buffer (for re-extraction of older
 *  uploads). Throws 404 if the file is missing on disk. */
export async function readResumeFile(path: string): Promise<Buffer> {
  try {
    return await fs.readFile(resolveOnDisk(STORAGE_BUCKET, path));
  } catch (err) {
    throw httpError(
      404,
      `Stored file not found: ${err instanceof Error ? err.message : 'read failed'}`,
    );
  }
}

export async function uploadResumeFile(
  consultantId: string,
  file: { buffer: Buffer; originalname: string; mimetype: string },
): Promise<{ path: string; size: number }> {
  const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${consultantId}/${Date.now()}-${safeName}`;
  const { error } = await db.storage
    .from(STORAGE_BUCKET)
    .upload(path, file.buffer, { contentType: file.mimetype, upsert: false });
  if (error) throw httpError(500, `Storage upload failed: ${error.message}`);
  return { path, size: file.buffer.length };
}

export async function getResumeSignedUrl(path: string, expiresIn = 60 * 60): Promise<string> {
  const { data, error } = await db.storage.from(STORAGE_BUCKET).createSignedUrl(path, expiresIn);
  if (error || !data) throw httpError(500, `Signed URL failed: ${error?.message}`);
  return data.signedUrl;
}

export async function deleteResumeFile(path: string): Promise<void> {
  const { error } = await db.storage.from(STORAGE_BUCKET).remove([path]);
  if (error) throw httpError(500, `Storage delete failed: ${error.message}`);
}
