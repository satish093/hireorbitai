import { RequestHandler } from 'express';
import { db } from '../config/db';
import { httpError } from '../types';
import { assertCanAccessTask, assertCanDeleteTaskChild } from '../services/taskAccess';

const BUCKET = 'task-attachments';

/** List attachments. Each entry includes a short-lived signed download URL. */
export const list: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  // Centralised guard: admin-tier unscoped; group leads only their group's
  // tasks; everyone else only their own assigned/created tasks. Previously
  // this returned true for ANY MANAGER_TIER which let a lead list a peer
  // group's attachments AND mint signed download URLs for them.
  await assertCanAccessTask(req.user, req.params.taskId);

  const { data, error } = await db
    .from('task_attachments')
    .select(`*, uploader:users!uploaded_by ( id, email, full_name )`)
    .eq('task_id', req.params.taskId)
    .order('created_at', { ascending: false });
  if (error) throw httpError(500, 'Database error');

  const withUrls = await Promise.all(
    (data ?? []).map(async (a: any) => {
      const { data: signed } = await db.storage.from(BUCKET).createSignedUrl(a.storage_path, 3600);
      return { ...a, download_url: signed?.signedUrl ?? null };
    }),
  );
  res.json(withUrls);
};

/** Upload an attachment. multipart/form-data: { file }. */
export const upload: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  await assertCanAccessTask(req.user, req.params.taskId);

  const file = (req as any).file as Express.Multer.File | undefined;
  if (!file) throw httpError(400, 'Missing file');

  const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${req.params.taskId}/${Date.now()}-${safeName}`;
  const { error: upErr } = await db.storage
    .from(BUCKET)
    .upload(path, file.buffer, { contentType: file.mimetype, upsert: false });
  if (upErr) throw httpError(500, `Storage upload failed: ${upErr.message}`);

  const { data, error } = await db
    .from('task_attachments')
    .insert({
      task_id: req.params.taskId,
      uploaded_by: req.user.id,
      file_name: file.originalname,
      storage_path: path,
      mime_type: file.mimetype,
      size_bytes: file.buffer.length,
    })
    .select()
    .single();
  if (error) throw httpError(500, 'Database error');
  res.status(201).json(data);
};

/** Delete an attachment (DB row + object). Uploader, admin-tier, or a group
 *  lead with access to the parent task. */
export const remove: RequestHandler = async (req, res) => {
  if (!req.user) throw httpError(401, 'Not authenticated');
  const { data: row } = await db
    .from('task_attachments')
    .select('*')
    .eq('id', req.params.id)
    .single();
  if (!row) throw httpError(404, 'Attachment not found');

  // Uploader can always delete their own. For someone else's attachment:
  //   admin-tier        → allowed (workspace oversight)
  //   group lead        → allowed only when the parent task is in their group
  //   everyone else     → denied (a plain RECRUITER/CONSULTANT who is the task
  //                       assignee or creator may READ + UPLOAD attachments,
  //                       but NOT delete someone else's). Prior shape used
  //                       assertCanAccessTask which let assignees/creators
  //                       silently delete co-workers' files.
  if (row.uploaded_by !== req.user.id) {
    await assertCanDeleteTaskChild(req.user, row.task_id);
  }

  await db.storage.from(BUCKET).remove([row.storage_path]);
  const { error } = await db.from('task_attachments').delete().eq('id', row.id);
  if (error) throw httpError(500, 'Database error');
  res.json({ ok: true });
};
