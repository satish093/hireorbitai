import { db } from '../config/db';
import { STORAGE_BUCKET } from '../config/storage.local';
import { httpError } from '../types';

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
