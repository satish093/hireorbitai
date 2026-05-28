import { RequestHandler } from 'express';
import { db } from '../config/db';
import { httpError } from '../types';
import { canMessageUser } from '../services/permission.service';
import { audit } from '../services/audit.service';

const BUCKET = 'message-attachments';
const SIGNED_URL_TTL_SECONDS = 3600;

/**
 * Two-phase upload for DM attachments:
 *
 *   1) POST /messages/attachments  ──► creates an "orphan" row with
 *      message_id = NULL, returns the row + a signed download URL. The
 *      sender holds the row id locally while they continue typing.
 *   2) POST /messages              ──► body includes attachment_ids[];
 *      the send handler links each orphan to the new message in one
 *      UPDATE. Orphans not claimed within 24h are swept by a periodic
 *      job (see backend/src/jobs/scheduler.ts — to be added).
 *
 * This matches the way taskAttachments works EXCEPT for the orphan
 * window, which we need because messages are typed-then-sent (no parent
 * row exists at upload time, unlike tasks where the user is already on
 * a task detail page).
 *
 * Permission: the uploader must already be allowed to message the
 * intended recipient (canMessageUser). Without this guard an attacker
 * could upload arbitrary files into our storage even if they can never
 * actually send the message — wasting disk + creating an exfil surface.
 */

const MIME_IMAGE = /^image\//;

/** Mint the signed download URL for an attachment row. Best-effort — a
 *  signing failure returns null and the client renders the row without
 *  a download link (it'll retry on the next list call). */
async function withSignedUrl<T extends { storage_path: string }>(
  row: T,
): Promise<T & { download_url: string | null }> {
  const { data } = await db.storage
    .from(BUCKET)
    .createSignedUrl(row.storage_path, SIGNED_URL_TTL_SECONDS);
  return { ...row, download_url: data?.signedUrl ?? null };
}

/** POST /messages/attachments — multipart { file, recipient_id }. */
export const upload: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');

  const recipientId = String(req.body?.recipient_id ?? '').trim();
  if (!recipientId) throw httpError(400, 'Missing recipient_id');
  if (recipientId === req.user.id) throw httpError(400, "Can't attach to yourself");

  // Recipient must exist + be active. Same checks as messages.send.
  const { data: recipient } = await db
    .from('users')
    .select('id, is_active')
    .eq('id', recipientId)
    .maybeSingle();
  if (!recipient) throw httpError(404, 'Recipient not found');
  if ((recipient as { is_active?: boolean }).is_active === false) {
    throw httpError(400, 'Recipient is inactive');
  }

  // Hierarchy guard — same predicate as the send handler so an attacker
  // can't burn storage attaching to users they can never DM.
  const allowed = await canMessageUser(
    { id: req.user.id, role: req.user.role, group_id: req.user.group_id ?? null },
    recipientId,
  );
  if (!allowed) {
    audit({
      action: 'messages_permission_denied',
      user_id: req.user.id,
      email: req.user.email ?? null,
      req,
      metadata: { route: 'attachment.upload', recipient: recipientId },
    });
    throw httpError(403, 'You cannot message this user.');
  }

  const file = (req as unknown as { file?: Express.Multer.File }).file;
  if (!file) throw httpError(400, 'Missing file');

  // pending/<uploader>/<timestamp>-<safe-name> — pending/ prefix marks
  // unclaimed orphans so the eventual sweep job can identify candidates
  // without a JOIN.
  const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `pending/${req.user.id}/${Date.now()}-${safeName}`;
  const { error: upErr } = await db.storage
    .from(BUCKET)
    .upload(path, file.buffer, { contentType: file.mimetype, upsert: false });
  if (upErr) throw httpError(500, `Storage upload failed: ${upErr.message}`);

  const { data, error } = await db
    .from('message_attachments')
    .insert({
      message_id: null,
      uploaded_by: req.user.id,
      recipient_user_id: recipientId,
      file_name: file.originalname,
      storage_path: path,
      mime_type: file.mimetype,
      size_bytes: file.buffer.length,
    })
    .select('*')
    .single();
  if (error || !data) {
    // Don't leave the file on disk if the insert failed.
    await db.storage
      .from(BUCKET)
      .remove([path])
      .catch(() => {});
    throw httpError(500, error?.message ?? 'Database error');
  }
  const row = data as { id: string; storage_path: string };
  res.status(201).json(await withSignedUrl(row));
};

/**
 * Claim helper used by messages.send — links a batch of orphan
 * attachments to a freshly-created message id.
 *
 * SECURITY: the WHERE clause requires (uploaded_by = caller AND
 * message_id IS NULL AND recipient_user_id = the message's recipient).
 * Without ALL THREE, an attacker who guesses another user's attachment
 * id could attach someone else's file to their own message (an exfil
 * vector since the attachment's signed-URL is then visible in the
 * sender's conversation view).
 *
 * Returns the rows that were actually linked. Silently ignores ids that
 * don't pass the WHERE — a no-op is preferable to a 500 that would
 * roll back a perfectly good message insert.
 */
export async function claimAttachmentsForMessage(args: {
  attachmentIds: string[];
  messageId: string;
  senderId: string;
  recipientId: string;
}): Promise<unknown[]> {
  const ids = (args.attachmentIds ?? []).filter((id) => typeof id === 'string' && id.length > 0);
  if (ids.length === 0) return [];
  const { data } = await db
    .from('message_attachments')
    .update({ message_id: args.messageId })
    .in('id', ids)
    .eq('uploaded_by', args.senderId)
    .eq('recipient_user_id', args.recipientId)
    .is('message_id', null)
    .select('*');
  return (data ?? []) as unknown[];
}

/** Embed the attachments for an array of message rows in one query.
 *  Used by thread + conversations + send response. */
export async function attachAttachments<T extends { id: string; attachments?: unknown }>(
  messages: T[],
): Promise<T[]> {
  if (messages.length === 0) return messages;
  const ids = messages.map((m) => m.id);
  const { data } = await db.from('message_attachments').select('*').in('message_id', ids);
  const rows = (data ?? []) as Array<{
    id: string;
    message_id: string;
    file_name: string;
    storage_path: string;
    mime_type: string | null;
    size_bytes: number | null;
    uploaded_by: string;
    created_at: string;
  }>;
  const byMessage = new Map<string, typeof rows>();
  for (const r of rows) {
    const bucket = byMessage.get(r.message_id) ?? [];
    bucket.push(r);
    byMessage.set(r.message_id, bucket);
  }
  // Mint signed URLs in parallel. Best-effort — a failure surfaces
  // download_url:null on that row; the client falls back to a name
  // chip with no download link.
  await Promise.all(
    rows.map(async (r) => {
      const { data: sig } = await db.storage
        .from(BUCKET)
        .createSignedUrl(r.storage_path, SIGNED_URL_TTL_SECONDS);
      (r as unknown as { download_url: string | null; is_image: boolean }).download_url =
        sig?.signedUrl ?? null;
      (r as unknown as { is_image: boolean }).is_image =
        !!r.mime_type && MIME_IMAGE.test(r.mime_type);
    }),
  );
  return messages.map((m) => ({
    ...m,
    attachments: byMessage.get(m.id) ?? [],
  }));
}

/** DELETE /messages/attachments/:id — uploader-only. */
export const remove: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const { data: row } = await db
    .from('message_attachments')
    .select('*')
    .eq('id', req.params.id)
    .maybeSingle();
  if (!row) throw httpError(404, 'Attachment not found');
  const a = row as { id: string; uploaded_by: string; storage_path: string };
  // Only the uploader may delete. No admin/lead override here — chat
  // is a personal conversation surface, not a workspace artifact like
  // a task attachment. If we ever need moderation we can extend this.
  if (a.uploaded_by !== req.user.id) throw httpError(404, 'Attachment not found');

  await db.storage
    .from(BUCKET)
    .remove([a.storage_path])
    .catch(() => {});
  const { error } = await db.from('message_attachments').delete().eq('id', a.id);
  if (error) throw httpError(500, 'Database error');
  res.json({ ok: true });
};
